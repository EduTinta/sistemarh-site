/** 1234.5 → "R$ 1.234,50". Valor ausente ou inválido vira "—". */
export function formatarMoeda(valor: number | null | undefined): string {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '—';
  return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * 1234.5 → "1.234,50", o formato que os campos de valor mostram para edição.
 * Valor ausente ou inválido (resposta fora do contrato) vira campo vazio.
 */
export function formatarValorEditavel(valor: number | null | undefined): string {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '';
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 10.5 → "10,5%" (até 2 casas, sem zeros sobrando). */
export function formatarPercentual(valor: number): string {
  return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

// Limites de negócio, os mesmos que a API aplica (ver FuncionarioDtos no backend).
export const SALARIO_MINIMO = 1;
export const SALARIO_MAXIMO = 1_000_000;
export const VALE_MINIMO = 0;
export const VALE_MAXIMO = 10_000;
export const PERCENTUAL_MINIMO = -50;
export const PERCENTUAL_MAXIMO = 100;
/** Acima dessa variação (para cima ou para baixo), a tela pede confirmação antes de gravar. */
export const VARIACAO_PEDE_CONFIRMACAO = 30;

// Grupos de milhar bem formados: "1", "12", "123", "1.234", "12.345.678"...
// O primeiro grupo não começa com zero (a não ser o próprio "0").
function ehGrupoDeMilhar(parteInteira: string, separador: '.' | ','): boolean {
  const grupos = parteInteira.split(separador);
  if (grupos.length < 2) return false;
  const [primeiro, ...resto] = grupos;
  return /^[1-9]\d{0,2}$/.test(primeiro) && resto.every((g) => /^\d{3}$/.test(g));
}

/**
 * Lê um valor em dinheiro do jeito que o RH digita ou cola, no formato
 * brasileiro, sem depender do idioma do navegador (o `type=number` lia
 * "5.000" como 5 e "1234,56" como 123456 no Chrome em inglês):
 *
 *   "5.000" → 5000      "3.500,00" → 3500     "1234,56" → 1234.56
 *   "1234.56" → 1234.56 "R$ 1.234,56" → 1234.56  "1.000.000" → 1000000
 *
 * Regras:
 * - "R$", espaços (inclusive NBSP) e um sinal de + ou - na frente são aceitos;
 * - com vírgula e ponto juntos, o último dos dois é o separador de centavos e
 *   o outro só pode aparecer como separador de milhar;
 * - só com pontos: "5.000" (grupos de 3 dígitos) é milhar; "1234.56" é decimal;
 * - no máximo 2 casas decimais. Com mais que isso, o valor é recusado em vez
 *   de ser arredondado em silêncio.
 *
 * Devolve `null` quando o texto está vazio ou não é um valor válido.
 */
export function lerValorMonetario(texto: string): number | null {
  let limpo = texto.replace(/\s+/g, '').replace(/^R\$/i, '');
  let sinal = 1;
  if (/^[+-]/.test(limpo)) {
    sinal = limpo[0] === '-' ? -1 : 1;
    limpo = limpo.slice(1).replace(/^R\$/i, '');
  }
  if (!limpo || !/^[\d.,]+$/.test(limpo) || !/\d/.test(limpo)) return null;

  const ultimoPonto = limpo.lastIndexOf('.');
  const ultimaVirgula = limpo.lastIndexOf(',');
  let inteira: string;
  let decimais = '';

  if (ultimoPonto >= 0 && ultimaVirgula >= 0) {
    // Os dois aparecem: o que vem por último separa os centavos.
    const separadorDecimal = ultimoPonto > ultimaVirgula ? '.' : ',';
    const separadorMilhar = separadorDecimal === '.' ? ',' : '.';
    const posicao = Math.max(ultimoPonto, ultimaVirgula);
    inteira = limpo.slice(0, posicao);
    decimais = limpo.slice(posicao + 1);
    if (inteira.includes(separadorDecimal)) return null;
    if (inteira.includes(separadorMilhar)) {
      if (!ehGrupoDeMilhar(inteira, separadorMilhar)) return null;
      inteira = inteira.split(separadorMilhar).join('');
    }
  } else if (ultimaVirgula >= 0) {
    const partes = limpo.split(',');
    if (partes.length === 2) {
      // Uma vírgula só: é a dos centavos ("1234,56", "10,5").
      [inteira, decimais] = partes;
    } else if (ehGrupoDeMilhar(limpo, ',')) {
      inteira = partes.join('');
    } else {
      return null;
    }
  } else if (ultimoPonto >= 0) {
    if (ehGrupoDeMilhar(limpo, '.')) {
      // "5.000", "1.000.000": ponto de milhar, como se escreve no Brasil.
      inteira = limpo.split('.').join('');
    } else {
      const partes = limpo.split('.');
      if (partes.length !== 2) return null;
      // "1234.56", "0.5": ponto decimal, como num valor copiado de planilha.
      [inteira, decimais] = partes;
    }
  } else {
    inteira = limpo;
  }

  if (!inteira) inteira = '0';
  if (!/^\d+$/.test(inteira) || !/^\d{0,2}$/.test(decimais)) return null;
  // Mais de 15 dígitos já não cabe com precisão num number do JavaScript.
  if (inteira.replace(/^0+/, '').length > 13) return null;

  const valor = Number(`${inteira}.${decimais || '0'}`) * sinal;
  return Number.isFinite(valor) ? valor : null;
}

/**
 * Prévia mostrada junto do campo de valor, para o RH ver como o número foi
 * entendido antes de gravar: "= R$ 5.000,00". Campo vazio não mostra nada.
 */
export function previaMonetaria(texto: string): { texto: string; valido: boolean } | null {
  if (!texto.trim()) return null;
  const valor = lerValorMonetario(texto);
  if (valor === null) return { texto: 'Valor inválido. Use o formato 1.234,56.', valido: false };
  return { texto: `= ${valor < 0 ? '- ' : ''}${formatarMoeda(Math.abs(valor))}`, valido: true };
}

/**
 * Lê um percentual ("10", "10,5", "-7.25", "12,5%"). Aceita vírgula ou ponto
 * como separador decimal, até 2 casas. Vazio ou inválido vira `null`.
 */
export function lerPercentual(texto: string): number | null {
  const limpo = texto.replace(/\s+/g, '').replace(/%$/, '');
  const partes = limpo.match(/^([+-]?)(\d{1,4})(?:[.,](\d{1,2}))?$/);
  if (!partes) return null;
  const [, sinal, inteira, decimais = '0'] = partes;
  const valor = Number(`${inteira}.${decimais}`) * (sinal === '-' ? -1 : 1);
  return Number.isFinite(valor) ? valor : null;
}

/** Arredonda pra centavos (evita 11000.000000000002 em contas de percentual). */
export function arredondarCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Variação em % de `atual` para `novo`. Partindo de zero, qualquer valor
 * positivo conta como variação infinita (sempre pede confirmação).
 */
export function variacaoPercentual(atual: number, novo: number): number {
  if (atual === 0) return novo === 0 ? 0 : Infinity;
  return ((novo - atual) / atual) * 100;
}

/**
 * Se a mudança de `atual` para `novo` passa de 30% e por isso pede
 * confirmação. A comparação é feita com a diferença em reais, e não com o
 * percentual já arredondado: 30% de R$ 1.234,56 dá R$ 1.604,928, que vira
 * R$ 1.604,93 (30,00016%) só por causa dos centavos. Por isso a margem de meio
 * centavo, mais uma tolerância de ponto flutuante: exatamente 30% nunca pede
 * confirmação, em qualquer salário.
 */
export function pedeConfirmacao(atual: number, novo: number): boolean {
  if (atual === 0) return novo !== 0;
  const limite = Math.abs(atual) * (VARIACAO_PEDE_CONFIRMACAO / 100) + 0.005;
  return Math.abs(novo - atual) > limite + 1e-9;
}

/**
 * Texto do "Confirma?" das mudanças grandes, por exemplo:
 * "O salário de Ana passa de R$ 5.000,00 para R$ 8.000,00 (aumento de 60%)."
 */
export function mensagemConfirmacaoVariacao(descricao: string, atual: number, novo: number): string {
  const variacao = variacaoPercentual(atual, novo);
  const sentido = novo >= atual ? 'aumento' : 'redução';
  const detalhe = Number.isFinite(variacao) ? ` (${sentido} de ${formatarPercentual(Math.abs(variacao))})` : '';
  return (
    `${descricao} passa de ${formatarMoeda(atual)} para ${formatarMoeda(novo)}${detalhe}.\n\n` +
    `É uma mudança acima de ${VARIACAO_PEDE_CONFIRMACAO}%. Confirma que o valor está certo?`
  );
}

/** Valida um salário já lido. Devolve a mensagem de erro ou null. */
export function validarSalario(valor: number | null, rotulo = 'o salário'): string | null {
  if (valor === null) return `Informe ${rotulo} no formato 1.234,56.`;
  if (valor < SALARIO_MINIMO || valor > SALARIO_MAXIMO) {
    return `${rotuloMaiusculo(rotulo)} precisa estar entre ${formatarMoeda(SALARIO_MINIMO)} e ${formatarMoeda(SALARIO_MAXIMO)}.`;
  }
  return null;
}

/** Valida um valor de vale alimentação já lido. Devolve a mensagem de erro ou null. */
export function validarVale(valor: number | null): string | null {
  if (valor === null) return 'Informe o vale alimentação no formato 1.234,56.';
  if (valor < VALE_MINIMO || valor > VALE_MAXIMO) {
    return `O vale alimentação precisa estar entre ${formatarMoeda(VALE_MINIMO)} e ${formatarMoeda(VALE_MAXIMO)}.`;
  }
  return null;
}

function rotuloMaiusculo(rotulo: string): string {
  return rotulo.charAt(0).toUpperCase() + rotulo.slice(1);
}
