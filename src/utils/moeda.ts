/** 1234.5 → "R$ 1.234,50". Valor ausente ou inválido vira "—". */
export function formatarMoeda(valor: number | null | undefined): string {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '—';
  return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Texto de um input numérico → número. Vazio ou inválido vira null. */
export function lerValor(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.');
  if (!limpo) return null;
  const valor = Number(limpo);
  return Number.isFinite(valor) ? valor : null;
}

/** Arredonda pra centavos (evita 11000.000000000002 em contas de percentual). */
export function arredondarCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}
