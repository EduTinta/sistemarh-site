/** Formata uma entrada de CPF como "000.000.000-00", limitando a 11 dígitos. */
export function formatarCpf(valor: string): string {
  // Só dígitos ASCII: "\d" com a flag u aceitaria dígitos de outros alfabetos.
  const digitos = valor.replace(/[^0-9]/g, '').slice(0, 11);

  if (digitos.length <= 3) return digitos;
  if (digitos.length <= 6) return `${digitos.slice(0, 3)}.${digitos.slice(3)}`;
  if (digitos.length <= 9) return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6)}`;
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

/**
 * Confere os dois dígitos verificadores do CPF, como a API faz. Recusa
 * sequências repetidas ("111.111.111-11"), que passam na conta mas não existem.
 */
export function cpfValido(valor: string): boolean {
  const digitos = valor.replace(/[^0-9]/g, '');
  if (digitos.length !== 11 || /^(\d)\1{10}$/.test(digitos)) return false;

  const numeros = [...digitos].map(Number);
  const verificador = (quantidade: number) => {
    let soma = 0;
    for (let i = 0; i < quantidade; i++) soma += numeros[i] * (quantidade + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return verificador(9) === numeros[9] && verificador(10) === numeros[10];
}
