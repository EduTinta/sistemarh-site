import type { FuncionarioDto } from '../types/api';

// Segmenta por grafema (o que a pessoa enxerga como um caractere): assim 🇧🇷
// (dois code points) e 👍🏽 (emoji + tom de pele) não são cortados ao meio.
// Sem Intl.Segmenter (navegador antigo), cai para code point, que ao menos
// não deixa surrogate solto ("�").
const segmentador: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('pt-BR', { granularity: 'grapheme' })
    : null;

function primeiroCaractere(texto: string): string {
  if (segmentador) {
    for (const { segment } of segmentador.segment(texto)) return segment;
    return '';
  }
  return Array.from(texto)[0] ?? '';
}

/** "Maria da Silva" → "MS". */
export function iniciais(nome: string): string {
  // Tira os invisíveis (zero-width, RTL override), mas não o ZWJ nem as tags
  // de bandeira, que fazem parte de emoji como 👨‍👩‍👧 e 🏴󠁧󠁢󠁳󠁣󠁴󠁿.
  const partes = nome
    .replace(/(?![‍\u{E0020}-\u{E007F}])\p{Cf}/gu, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return primeiroCaractere(partes[0]).toUpperCase();
  return (primeiroCaractere(partes[0]) + primeiroCaractere(partes[partes.length - 1])).toUpperCase();
}

/**
 * Minúsculas, sem acentos e com os espaços normalizados, pra "joao" achar
 * "João" e "Ana  Souza" (espaço duplo ou NBSP, que a tela mostra como um só)
 * achar "Ana Souza". Os caracteres invisíveis (zero-width etc.) saem também.
 */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Filtra por nome, e-mail, departamento, cargo ou CPF (com ou sem máscara).
 * Busca vazia devolve a lista inteira.
 */
export function filtrarFuncionarios(lista: FuncionarioDto[], busca: string): FuncionarioDto[] {
  const termo = normalizarBusca(busca);
  if (!termo) return lista;
  // "680.055.670-06", "68005567006" ou "680 055": compara só os dígitos do CPF.
  const pareceCpf = /^[\d.\-\s]+$/.test(termo) && /\d{3}/.test(termo);
  const digitos = pareceCpf ? termo.replace(/\D/g, '') : '';
  return lista.filter(
    (f) =>
      [f.nome, f.email, f.departamentoNome, f.cargoNome, f.cpf].some((campo) =>
        normalizarBusca(campo ?? '').includes(termo)
      ) ||
      (digitos !== '' && (f.cpf ?? '').replace(/\D/g, '').includes(digitos))
  );
}

export function ordenarPorNome(lista: FuncionarioDto[]): FuncionarioDto[] {
  return [...lista].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** "1 colaborador" / "3 colaboradores". */
export function contarColaboradores(quantidade: number): string {
  return `${quantidade} colaborador${quantidade === 1 ? '' : 'es'}`;
}

/**
 * Ids de todos que estão abaixo de `id` na hierarquia (subordinados diretos e
 * indiretos). Usado para não oferecer como gestor alguém que fecharia um ciclo.
 */
export function idsDaEquipe(lista: FuncionarioDto[], id: number): Set<number> {
  const porGestor = new Map<number, number[]>();
  for (const f of lista) {
    if (f.gerenteId === null) continue;
    porGestor.set(f.gerenteId, [...(porGestor.get(f.gerenteId) ?? []), f.id]);
  }
  const equipe = new Set<number>();
  const pendentes = [...(porGestor.get(id) ?? [])];
  while (pendentes.length > 0) {
    const atual = pendentes.pop()!;
    if (equipe.has(atual) || atual === id) continue;
    equipe.add(atual);
    pendentes.push(...(porGestor.get(atual) ?? []));
  }
  return equipe;
}
