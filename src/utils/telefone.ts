/**
 * Formata uma entrada de telefone com DDD enquanto o usuário digita, limitando
 * a 11 dígitos: "(00) 00000-0000" para celular (11 dígitos) e
 * "(00) 0000-0000" para fixo (10 dígitos).
 */
export function formatarTelefone(valor: string): string {
  const digitos = valor.replace(/\D/g, '').slice(0, 11);
  if (digitos.length === 0) return '';
  if (digitos.length <= 2) return `(${digitos}`;

  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);
  if (numero.length <= 4) return `(${ddd}) ${numero}`;
  if (digitos.length <= 10) return `(${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
  return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
}

/** Quantidade de dígitos do telefone (sem máscara). */
export function contarDigitosTelefone(valor: string): number {
  return valor.replace(/\D/g, '').length;
}
