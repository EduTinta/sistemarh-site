// Validações do painel, copiadas das regras da API (README do backend, seção
// 8, e Common/Textos.cs, Emails e Senhas). A API sempre valida de novo; aqui
// é para mostrar o erro antes de enviar, no campo certo e com a mesma
// mensagem. Se uma regra mudar no backend, ela muda aqui também.

import { hojeEmBrasilia, somarAnos, somarDias, formatarDataCalendario } from './datas';

// ── Caracteres recusados ─────────────────────────────────────────────────

/**
 * "Brancos" que não são de controle nem de formatação (Cc/Cf), mas também não
 * aparecem na tela: com eles dava pra ter um nome "em branco" que passava no
 * tamanho mínimo. Mesma lista de `Textos.EhInvisivelExtra` no backend.
 */
export function ehInvisivelExtra(codePoint: number): boolean {
  return (
    codePoint === 0x034f || // combining grapheme joiner
    codePoint === 0x115f || codePoint === 0x1160 || // fillers do hangul (jamo)
    codePoint === 0x3164 || codePoint === 0xffa0 || // hangul filler / halfwidth hangul filler
    codePoint === 0x17b4 || codePoint === 0x17b5 || // vogais invisíveis do khmer
    codePoint === 0x2800 || // braille em branco
    (codePoint >= 0x180b && codePoint <= 0x180f) || // seletores de variação e separador do mongol
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || // seletores de variação VS1–VS16
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef) // seletores de variação VS17–VS256
  );
}

/**
 * Partes de uma sequência de emoji que não são um caractere por si: U+FE0E,
 * U+FE0F, o ZWJ (U+200D), o keycap (U+20E3), os tons de pele (U+1F3FB–U+1F3FF)
 * e as tags de bandeira (U+E0020–U+E007F). Não contam para o tamanho mínimo
 * nem como "caractere visível". Mesma lista de `Textos.EhParteDeEmoji`.
 */
export function ehParteDeEmoji(codePoint: number): boolean {
  return (
    codePoint === 0xfe0e ||
    codePoint === 0xfe0f ||
    codePoint === 0x200d ||
    codePoint === 0x20e3 ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) ||
    (codePoint >= 0xe0020 && codePoint <= 0xe007f)
  );
}

/**
 * Base de emoji "desenhado": pode receber seletor de variação e tom de pele e
 * ser unida a outra pelo ZWJ. Mesmas faixas de `Textos.EhBaseDeEmoji`
 * (os tons de pele, apesar de estarem na faixa, não são base).
 */
export function ehBaseDeEmoji(codePoint: number): boolean {
  if (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) return false;
  return (
    (codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x2300 && codePoint <= 0x23ff) ||
    (codePoint >= 0x2b00 && codePoint <= 0x2bff) ||
    (codePoint >= 0x2190 && codePoint <= 0x21ff) ||
    (codePoint >= 0x2900 && codePoint <= 0x297f) ||
    codePoint === 0x3030 || codePoint === 0x303d || codePoint === 0x3297 || codePoint === 0x3299 ||
    codePoint === 0x00a9 || codePoint === 0x00ae || codePoint === 0x203c || codePoint === 0x2049 ||
    codePoint === 0x2122 || codePoint === 0x2139 ||
    codePoint === 0x24c2 || codePoint === 0x25aa || codePoint === 0x25ab || codePoint === 0x25b6 ||
    codePoint === 0x25c0 || (codePoint >= 0x25fb && codePoint <= 0x25fe)
  );
}

/** Base de keycap (1️⃣, #️⃣, *️⃣): aceita o seletor e o U+20E3, mas não tom de pele nem ZWJ. */
function ehBaseDeKeycap(codePoint: number): boolean {
  return (codePoint >= 0x30 && codePoint <= 0x39) || codePoint === 0x23 || codePoint === 0x2a;
}

const ehTag = (codePoint: number) => codePoint >= 0xe0020 && codePoint <= 0xe007e;
const ehTomDePele = (codePoint: number) => codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
const FIM_DAS_TAGS = 0xe007f;
const BANDEIRA_PRETA = 0x1f3f4;
const MAXIMO_DE_ZWJ_POR_SEQUENCIA = 10;
const MAXIMO_DE_TAGS_POR_BANDEIRA = 8;

// Cc (controle), Cf (formatação: zero-width, RTL override, BOM...), Zl, Zp e
// surrogate solto.
const CATEGORIA_INVISIVEL = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]$/u;
// Code point sem caractere atribuído (Cn).
const NAO_ATRIBUIDO = /^\p{Cn}$/u;
// Propriedade Unicode White_Space, a mesma de Rune.IsWhiteSpace no .NET.
const BRANCO = /^\p{White_Space}$/u;

/** Não-caracteres do Unicode (U+FDD0–U+FDEF e todo U+xFFFE/U+xFFFF). */
function ehNaoCaractere(codePoint: number): boolean {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef) || (codePoint & 0xfffe) === 0xfffe;
}

/**
 * Um code point de controle ou invisível, como `Textos.EhInvisivelOuControle`:
 * Cc, Cf, Zl, Zp, surrogate solto, os brancos extras, não-caracteres e code
 * points sem caractere (Cn). A exceção do Cn é a faixa dos emoji
 * (U+1F000–U+1FAFF): emoji novos ainda podem estar sem caractere na tabela.
 * Observação: a tabela Unicode do navegador pode ser mais nova que a do .NET;
 * um caractere recém-atribuído fora da faixa de emoji passa aqui e a API recusa.
 */
function ehInvisivelOuControle(codePoint: number): boolean {
  const caractere = String.fromCodePoint(codePoint);
  return (
    CATEGORIA_INVISIVEL.test(caractere) ||
    ehInvisivelExtra(codePoint) ||
    ehNaoCaractere(codePoint) ||
    (NAO_ATRIBUIDO.test(caractere) && !(codePoint >= 0x1f000 && codePoint <= 0x1faff))
  );
}

function ehBranco(codePoint: number): boolean {
  return BRANCO.test(String.fromCodePoint(codePoint));
}

/** Visível de verdade: não é branco, nem invisível, nem parte de emoji. */
function ehVisivel(codePoint: number): boolean {
  return !ehBranco(codePoint) && !ehInvisivelOuControle(codePoint) && !ehParteDeEmoji(codePoint);
}

/** Code points do texto (um surrogate solto vem sozinho, com o valor dele). */
function codePoints(texto: string): number[] {
  return Array.from(texto, (c) => c.codePointAt(0) ?? 0);
}

const ehSurrogate = (codePoint: number) => codePoint >= 0xd800 && codePoint <= 0xdfff;

/**
 * Se o texto tem algum caractere de controle ou invisível em qualquer posição
 * (inclusive quebra de linha). É a regra da senha (`Textos.TemInvisivelOuControle`).
 */
export function temCaractereInvisivel(texto: string): boolean {
  return codePoints(texto).some(ehInvisivelOuControle);
}

/** Se o texto tem emoji: base desenhada ou parte de sequência (`Textos.TemEmoji`). */
export function temEmoji(texto: string): boolean {
  return codePoints(texto).some((cp) => ehBaseDeEmoji(cp) || ehParteDeEmoji(cp));
}

/**
 * Confere, caractere a caractere, se as partes de emoji formam sequências de
 * emoji de verdade (cópia de `Textos.SequenciaDeEmoji`):
 * - seletor de variação (U+FE0E/U+FE0F): só depois de uma base de emoji ou de
 *   keycap (dígito, # ou *), no máximo um por base;
 * - keycap (U+20E3): só depois de dígito, # ou * (com ou sem seletor);
 * - tom de pele: só depois de uma base de emoji, no máximo um por base;
 * - ZWJ (U+200D): só ENTRE duas bases de emoji, no máximo 10 por sequência;
 * - tags (U+E0020–U+E007E): só logo depois da bandeira 🏴 (U+1F3F4), no máximo
 *   8, terminando em U+E007F.
 * Qualquer outro caractere segue a regra comum (invisível ou de controle é
 * recusado; a quebra de linha permitida passa).
 */
class SequenciaDeEmoji {
  private base: 'nenhuma' | 'emoji' | 'keycap' = 'nenhuma';
  private seletorUsado = false;
  private tomUsado = false;
  private depoisDoZwj = false;
  private zwjsNaSequencia = 0;
  private tags = -1; // -1: fora de uma bandeira com tags
  private anterior = -1;

  /** Falso se o texto acabou no meio de uma bandeira com tags. */
  get terminada(): boolean {
    return this.tags < 0;
  }

  aceitar(codePoint: number, quebraPermitida: boolean, proximo: number | undefined): boolean {
    const aceito = this.avaliar(codePoint, quebraPermitida, proximo);
    this.anterior = codePoint;
    return aceito;
  }

  private avaliar(codePoint: number, quebraPermitida: boolean, proximo: number | undefined): boolean {
    if (this.tags >= 0) {
      if (ehTag(codePoint)) return ++this.tags <= MAXIMO_DE_TAGS_POR_BANDEIRA;
      if (codePoint === FIM_DAS_TAGS) {
        // Bandeira fechada: nada mais se junta a ela.
        this.tags = -1;
        this.base = 'nenhuma';
        return true;
      }
      return false;
    }

    if (ehTag(codePoint)) {
      if (this.anterior !== BANDEIRA_PRETA) return false;
      this.tags = 1;
      return true;
    }
    if (codePoint === FIM_DAS_TAGS) return false;
    if (codePoint === 0xfe0e || codePoint === 0xfe0f) {
      if (this.base === 'nenhuma' || this.seletorUsado) return false;
      this.seletorUsado = true;
      return true;
    }
    if (codePoint === 0x20e3) {
      if (this.base !== 'keycap') return false;
      this.base = 'nenhuma';
      return true;
    }
    if (ehTomDePele(codePoint)) {
      if (this.base !== 'emoji' || this.tomUsado) return false;
      this.tomUsado = true;
      return true;
    }
    if (codePoint === 0x200d) {
      const proximoEhBase = proximo !== undefined && !ehSurrogate(proximo) && ehBaseDeEmoji(proximo);
      if (this.base !== 'emoji' || !proximoEhBase || ++this.zwjsNaSequencia > MAXIMO_DE_ZWJ_POR_SEQUENCIA) return false;
      this.base = 'nenhuma';
      this.depoisDoZwj = true;
      return true;
    }

    if (!quebraPermitida && ehInvisivelOuControle(codePoint)) return false;

    // Caractere comum: começa uma base nova (ou nenhuma).
    if (!this.depoisDoZwj) this.zwjsNaSequencia = 0;
    this.depoisDoZwj = false;
    this.seletorUsado = false;
    this.tomUsado = false;
    this.base = ehBaseDeEmoji(codePoint) ? 'emoji' : ehBaseDeKeycap(codePoint) ? 'keycap' : 'nenhuma';
    return true;
  }
}

// ── Regras de texto ──────────────────────────────────────────────────────

/** Como um campo de texto é validado (espelho de `RegraTexto` no backend). */
export interface RegraTexto {
  /** Começa com maiúscula, como na mensagem: "O nome", "A resposta". */
  rotulo: string;
  minimo: number;
  maximo: number;
  mensagemObrigatorio: string;
  /** Texto longo: aceita quebra de linha (no máximo 2 seguidas). */
  multiLinha?: boolean;
  /** Aceita as partes de emoji mesmo sendo de uma linha (assunto da mensagem). */
  permiteEmoji?: boolean;
}

export const REGRA_NOME_PESSOA: RegraTexto = { rotulo: 'O nome', minimo: 3, maximo: 120, mensagemObrigatorio: 'O nome é obrigatório.' };
export const REGRA_NOME_DEPARTAMENTO: RegraTexto = { rotulo: 'O nome do departamento', minimo: 2, maximo: 100, mensagemObrigatorio: 'O nome do departamento é obrigatório.' };
export const REGRA_NOME_CARGO: RegraTexto = { rotulo: 'O nome do cargo', minimo: 2, maximo: 100, mensagemObrigatorio: 'O nome do cargo é obrigatório.' };
export const REGRA_MOTIVO: RegraTexto = { rotulo: 'O motivo', minimo: 3, maximo: 500, mensagemObrigatorio: 'Informe o motivo do ajuste.', multiLinha: true };
export const REGRA_DESCRICAO_AUSENCIA: RegraTexto = { rotulo: 'A descrição', minimo: 3, maximo: 2000, mensagemObrigatorio: 'Descreva o motivo da ausência.', multiLinha: true };
export const REGRA_ASSUNTO_MENSAGEM: RegraTexto = { rotulo: 'O assunto', minimo: 3, maximo: 100, mensagemObrigatorio: 'Informe o assunto da mensagem.', permiteEmoji: true };
export const REGRA_CORPO_MENSAGEM: RegraTexto = { rotulo: 'A mensagem', minimo: 3, maximo: 2000, mensagemObrigatorio: 'Escreva a mensagem.', multiLinha: true };
export const REGRA_RESPOSTA_MENSAGEM: RegraTexto = { rotulo: 'A resposta', minimo: 3, maximo: 2000, mensagemObrigatorio: 'Escreva a resposta.', multiLinha: true };

export const NOME_PESSOA_MAXIMO = REGRA_NOME_PESSOA.maximo;
export const NOME_DEPARTAMENTO_MAXIMO = REGRA_NOME_DEPARTAMENTO.maximo;
export const MOTIVO_MAXIMO = REGRA_MOTIVO.maximo;
export const EMAIL_MAXIMO = 254;
export const SENHA_APP_MINIMO = 6;
export const SENHA_APP_MAXIMO = 64;

/**
 * Confere os caracteres como `Textos.Limpar` (antes de limpar):
 * - qualquer controle ou invisível é recusado; nos textos longos, só \n e \r passam;
 * - nos textos longos e no assunto, as partes de emoji só passam onde formam
 *   uma sequência de emoji de verdade (`SequenciaDeEmoji`). Assim "❤️", "👍🏽",
 *   "👨‍👩‍👧", "🏳️‍🌈", "1️⃣" e "🏴󠁧󠁢󠁳󠁣󠁴󠁿" passam, mas "Oi" + seletores ou um texto
 *   escondido em tags não.
 * Devolve a mensagem de erro ou null.
 */
function conferirCaracteres(valor: string, regra: RegraTexto): string | null {
  const mensagem = `${regra.rotulo} contém caracteres invisíveis ou de controle, que não são permitidos.`;
  const aceitaEmoji = !!(regra.multiLinha || regra.permiteEmoji);
  const pontos = codePoints(valor);
  const emoji = new SequenciaDeEmoji();

  for (let i = 0; i < pontos.length; i++) {
    const codePoint = pontos[i];
    // Surrogate solto não é caractere nenhum (a API nem consegue decodificar).
    if (ehSurrogate(codePoint)) return mensagem;
    const quebraPermitida = !!regra.multiLinha && (codePoint === 0x0a || codePoint === 0x0d);
    const aceito = aceitaEmoji
      ? emoji.aceitar(codePoint, quebraPermitida, pontos[i + 1])
      : quebraPermitida || !ehInvisivelOuControle(codePoint);
    if (!aceito) return mensagem;
  }
  // Bandeira com tags que não fecharam com U+E007F.
  if (aceitaEmoji && !emoji.terminada) return mensagem;
  return null;
}

/**
 * Limpeza de campo de UMA linha (nome, departamento, cargo, assunto): espaços
 * repetidos (espaço, NBSP e os outros separadores \p{Zs}) viram um só e as
 * pontas são aparadas. Quebra de linha e tab não são convertidas: a validação
 * as recusa, como a API.
 */
export function limparTexto(texto: string): string {
  return texto.replace(/\p{Zs}+/gu, ' ').trim();
}

/**
 * Limpeza de texto LONGO (motivo, descrição, mensagem e resposta), na mesma
 * ordem da API: \r\n e \r viram \n; espaços repetidos viram um só; cada linha
 * é aparada (uma linha só de espaços fica vazia); quebras seguidas ficam no
 * máximo 2; as pontas do texto são aparadas.
 */
export function limparTextoLongo(texto: string): string {
  return texto
    .replace(/\r\n?/g, '\n')
    .replace(/\p{Zs}+/gu, ' ')
    .split('\n')
    .map((linha) => linha.replace(/^ +| +$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Tamanho de um texto em caracteres de verdade (code points), como a API conta
 * o MÁXIMO (`EnumerateRunes().Count()`) e como o `varchar` do MySQL guarda:
 * "👍" conta 1, e não 2. Usado nos contadores "x/500" das telas.
 */
export function contarCaracteres(texto: string): number {
  return Array.from(texto).length;
}

/** Texto limpo conforme a regra (uma linha ou longo). */
export function limparConformeRegra(texto: string, regra: RegraTexto): string {
  return regra.multiLinha ? limparTextoLongo(texto) : limparTexto(texto);
}

/**
 * Tamanho como `Textos.ConferirTamanho`: o MÍNIMO não conta as partes de emoji
 * ("a" + 2 seletores tem 3 code points e 1 caractere na tela); o MÁXIMO conta
 * todos os code points, porque é o que ocupa a coluna no banco.
 */
function conferirTamanho(limpo: string, regra: RegraTexto): string | null {
  const pontos = codePoints(limpo);
  const partesDeEmoji = pontos.filter(ehParteDeEmoji).length;
  if (pontos.length - partesDeEmoji < regra.minimo) return `${regra.rotulo} precisa ter pelo menos ${regra.minimo} caracteres.`;
  if (pontos.length > regra.maximo) return `${regra.rotulo} pode ter no máximo ${regra.maximo} caracteres.`;
  return null;
}

// Um texto absurdamente maior que o permitido nem é percorrido (igual à API).
function grandeDemais(texto: string, regra: RegraTexto): boolean {
  return regra.maximo > 0 && texto.length > regra.maximo * 4 + 1000;
}

/**
 * Valida um texto obrigatório como `Textos.Validar`: caracteres, pelo menos 1
 * caractere visível de verdade e tamanho contado DEPOIS da limpeza. Devolve a
 * mensagem de erro ou null.
 */
export function validarTexto(texto: string, regra: RegraTexto): string | null {
  if (!texto) return regra.mensagemObrigatorio;
  if (grandeDemais(texto, regra)) return `${regra.rotulo} pode ter no máximo ${regra.maximo} caracteres.`;
  const erroCaracteres = conferirCaracteres(texto, regra);
  if (erroCaracteres) return erroCaracteres;
  const limpo = limparConformeRegra(texto, regra);
  if (!limpo || !codePoints(limpo).some(ehVisivel)) return regra.mensagemObrigatorio;
  return conferirTamanho(limpo, regra);
}

/** Como `validarTexto`, mas vazio (ou só espaços) é aceito (`Textos.ValidarOpcional`). */
export function validarTextoOpcional(texto: string, regra: RegraTexto): string | null {
  if (!texto) return null;
  if (grandeDemais(texto, regra)) return `${regra.rotulo} pode ter no máximo ${regra.maximo} caracteres.`;
  const erroCaracteres = conferirCaracteres(texto, regra);
  if (erroCaracteres) return erroCaracteres;
  const limpo = limparConformeRegra(texto, regra);
  if (!limpo) return null;
  return conferirTamanho(limpo, regra);
}

/**
 * Texto longo com rótulo e limites livres (ex. a resposta do RH). `rotulo` pode
 * vir em minúscula ("a resposta"); a mensagem sai com maiúscula.
 */
export function validarTextoLongo(texto: string, rotulo: string, minimo: number, maximo: number): string | null {
  const rotuloMaiusculo = maiuscula(rotulo);
  return validarTexto(texto, {
    rotulo: rotuloMaiusculo,
    minimo,
    maximo,
    mensagemObrigatorio: `Informe ${rotulo}.`,
    multiLinha: true,
  });
}

/**
 * Nome de pessoa: regra estrita (nenhuma parte de emoji), 3 a 120 caracteres
 * e pelo menos 2 letras contadas por code point ("𝓐𝓷𝓪 𝓢𝓲𝓵𝓿𝓪" tem 8).
 */
export function validarNomePessoa(nome: string): string | null {
  const erro = validarTexto(nome, REGRA_NOME_PESSOA);
  if (erro) return erro;
  const letras = Array.from(limparTexto(nome)).filter((c) => /^\p{L}$/u.test(c)).length;
  if (letras < 2) return `${REGRA_NOME_PESSOA.rotulo} precisa ter pelo menos 2 letras.`;
  return null;
}

/** Nome de departamento: 2 a 100 caracteres, regra estrita. */
export function validarNomeDepartamento(nome: string): string | null {
  return validarTexto(nome, REGRA_NOME_DEPARTAMENTO);
}

/** Motivo de ajuste ou promoção: texto longo de 3 a 500 caracteres. */
export function validarMotivo(motivo: string, rotulo?: string): string | null {
  return validarTexto(
    motivo,
    rotulo ? { ...REGRA_MOTIVO, rotulo: maiuscula(rotulo), mensagemObrigatorio: `Informe ${rotulo}.` } : REGRA_MOTIVO
  );
}

// ── E-mail ───────────────────────────────────────────────────────────────

// Mesma expressão de `Emails.Formato()` no backend. Parte local (até 64):
// letras, dígitos e . ! # $ % & ' * + / = ? ^ _ ` { | } ~ -, sem ponto no
// começo, no fim nem ".." (então "o'neil@empresa.com" passa). Domínio:
// rótulos de 1 a 63 (letras, dígitos e hífen fora das pontas) e TLD só de
// letras, de 2 a 63. Aplicada já em minúsculas.
const FORMATO_EMAIL =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const MENSAGEM_EMAIL_INVALIDO = 'Informe um e-mail válido, no formato usuario@dominio.com.';

/** E-mail como a API grava: sem espaços nas pontas e em minúsculas. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Valida um e-mail preenchido (`Emails.NormalizarOpcional`). Devolve a mensagem de erro ou null. */
export function validarEmail(email: string): string | null {
  const candidato = email.trim();
  if (candidato.length > EMAIL_MAXIMO) return `O e-mail pode ter no máximo ${EMAIL_MAXIMO} caracteres.`;
  // Só ASCII visível: acento, espaço no meio ou caractere de controle recusam.
  if (/[^\x21-\x7e]/.test(candidato)) return MENSAGEM_EMAIL_INVALIDO;
  const minusculo = candidato.toLowerCase();
  const arroba = minusculo.indexOf('@');
  if (arroba < 1 || arroba > 64 || !FORMATO_EMAIL.test(minusculo)) return MENSAGEM_EMAIL_INVALIDO;
  return null;
}

// ── Senhas ───────────────────────────────────────────────────────────────

export const MENSAGEM_SENHA_EMOJI_OU_INVISIVEL = 'A senha não pode conter emoji nem caracteres invisíveis.';
export const MENSAGEM_SENHA_ATUAL_OBRIGATORIA = 'Informe a senha atual.';
export const MENSAGEM_NOVA_SENHA_IGUAL = 'A nova senha precisa ser diferente da atual.';
export const MENSAGEM_SENHA_PROVISORIA_OBRIGATORIA = 'Defina uma senha provisória para a conta promovida.';

/**
 * Regra de qualquer senha, na ordem de `Senhas.Validar`: 6 a 64 caracteres de
 * verdade (code points), não pode ser só espaços, não pode ter emoji nem
 * caractere invisível ou de controle (o mesmo coração chega como "❤" de um
 * teclado e "❤️" de outro, e a pessoa não entra mais pelo outro aparelho) e
 * não pode começar nem terminar com espaço. `rotulo` é o começo da mensagem,
 * como na API ("A senha de acesso ao app", "A nova senha", "A senha provisória").
 */
export function validarSenha(senha: string, rotulo = 'A senha de acesso ao app'): string | null {
  const mensagemCurta = `${rotulo} precisa ter pelo menos ${SENHA_APP_MINIMO} caracteres.`;
  if (!senha) return mensagemCurta;
  if (/^\p{White_Space}+$/u.test(senha)) return `${rotulo} não pode ser formada só por espaços.`;
  if (temCaractereInvisivel(senha) || temEmoji(senha)) return MENSAGEM_SENHA_EMOJI_OU_INVISIVEL;
  if (/^\p{White_Space}|\p{White_Space}$/u.test(senha)) return `${rotulo} não pode começar nem terminar com espaço.`;
  const tamanho = Array.from(senha).length;
  if (tamanho < SENHA_APP_MINIMO) return mensagemCurta;
  if (tamanho > SENHA_APP_MAXIMO) return `${rotulo} pode ter no máximo ${SENHA_APP_MAXIMO} caracteres.`;
  return null;
}

/** Senha do app definida pelo RH (cadastro e "Criar acesso ao app"). */
export function validarSenhaApp(senha: string): string | null {
  return validarSenha(senha, 'A senha de acesso ao app');
}

/**
 * Senha nova, com as mensagens da API:
 * - troca da própria senha (`PUT /api/auth/senha`): passe `senhaAtual`. A
 *   ordem é a do backend: "Informe a senha atual.", as regras de senha com o
 *   rótulo "A nova senha" e "A nova senha precisa ser diferente da atual.";
 * - senha provisória da promoção de perfil: use `validarSenhaProvisoria`.
 * Devolve a mensagem de erro ou null.
 */
export function validarSenhaNova(
  novaSenha: string,
  opcoes: { senhaAtual?: string; rotulo?: string } = {}
): string | null {
  const { senhaAtual, rotulo = 'A nova senha' } = opcoes;
  if (senhaAtual !== undefined && !senhaAtual) return MENSAGEM_SENHA_ATUAL_OBRIGATORIA;
  const erro = validarSenha(novaSenha, rotulo);
  if (erro) return erro;
  if (senhaAtual !== undefined && novaSenha === senhaAtual) return MENSAGEM_NOVA_SENHA_IGUAL;
  return null;
}

/**
 * Senha provisória que o Admin define ao promover uma conta (perfil que sobe).
 * Vazia dá "Defina uma senha provisória para a conta promovida."; preenchida
 * segue as regras de senha com o rótulo "A senha provisória".
 */
export function validarSenhaProvisoria(senha: string): string | null {
  if (!senha) return MENSAGEM_SENHA_PROVISORIA_OBRIGATORIA;
  return validarSenhaNova(senha, { rotulo: 'A senha provisória' });
}

// ── Datas (todas como "YYYY-MM-DD") ──────────────────────────────────────

export const DATA_MINIMA_NASCIMENTO = '1900-01-01';
export const IDADE_MINIMA = 14;
export const DIAS_ADMISSAO_FUTURA = 90;

/** Maior data de nascimento aceita: hoje menos 14 anos. */
export function nascimentoMaximo(): string {
  return somarAnos(hojeEmBrasilia(), -IDADE_MINIMA);
}

/** Faixa da admissão: de nascimento + 14 anos até hoje + 90 dias. */
export function faixaAdmissao(dataNascimento?: string | null): { minimo: string; maximo: string } {
  return {
    minimo: dataNascimento ? somarAnos(dataNascimento, IDADE_MINIMA) : DATA_MINIMA_NASCIMENTO,
    maximo: somarDias(hojeEmBrasilia(), DIAS_ADMISSAO_FUTURA),
  };
}

function dataValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return somarDias(iso, 0) === iso;
}

export function validarDataNascimento(iso: string): string | null {
  if (!iso) return null;
  if (!dataValida(iso)) return 'Data de nascimento inválida.';
  if (iso < DATA_MINIMA_NASCIMENTO) return 'A data de nascimento precisa ser a partir de 01/01/1900.';
  if (iso > nascimentoMaximo()) return `O colaborador precisa ter pelo menos ${IDADE_MINIMA} anos.`;
  return null;
}

export function validarDataAdmissao(iso: string, dataNascimento?: string | null): string | null {
  if (!iso) return 'Informe a data de admissão.';
  if (!dataValida(iso)) return 'Data de admissão inválida.';
  const { minimo, maximo } = faixaAdmissao(dataNascimento);
  if (iso < minimo) {
    return dataNascimento
      ? `A admissão precisa ser depois dos ${IDADE_MINIMA} anos do colaborador (a partir de ${formatarDataCalendario(minimo)}).`
      : 'Data de admissão inválida.';
  }
  if (iso > maximo) return `A admissão pode ser no máximo ${DIAS_ADMISSAO_FUTURA} dias à frente (até ${formatarDataCalendario(maximo)}).`;
  return null;
}

/**
 * Última vigência aceita: hoje, ou a própria admissão para quem ainda vai ser
 * admitido (a API usa max(hoje, admissão)).
 */
export function vigenciaMaxima(dataAdmissao?: string | null): string {
  const hoje = hojeEmBrasilia();
  return dataAdmissao && dataAdmissao > hoje ? dataAdmissao : hoje;
}

/** Vigência de ajuste: da admissão até max(hoje, admissão). */
export function validarVigencia(iso: string, dataAdmissao?: string | null): string | null {
  if (!iso) return 'Informe a data de vigência.';
  if (!dataValida(iso)) return 'Data de vigência inválida.';
  if (dataAdmissao && dataAdmissao > hojeEmBrasilia() && iso !== dataAdmissao) {
    return `Para quem ainda vai ser admitido, a vigência é a própria data de admissão (${formatarDataCalendario(dataAdmissao)}).`;
  }
  if (iso > vigenciaMaxima(dataAdmissao)) return 'Ajustes com data futura ainda não são suportados.';
  if (dataAdmissao && iso < dataAdmissao) {
    return `A vigência não pode ser anterior à admissão (${formatarDataCalendario(dataAdmissao)}).`;
  }
  return null;
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
