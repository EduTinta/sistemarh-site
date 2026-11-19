// Acima disso o texto colado não é um telefone (ou é um telefone com ramal,
// lixo etc.); o campo guarda até aqui só para mostrar o erro sem esconder o
// que foi colado.
const DIGITOS_MAXIMOS_NO_CAMPO = 20;

/**
 * Dígitos do telefone. Só tira o que é sem dúvida um prefixo:
 * - o código do país, quando vem explícito: "+55 (11) 98765-4321" ou
 *   "0055 11 98765-4321";
 * - o zero de operadora antes do DDD: "011 98765-4321".
 * Fora isso, nada é reescrito: "55 99999-9999" com um dígito a mais (ou um
 * ramal colado) fica com dígitos demais e vira erro, em vez de virar outro
 * número de DDD 99 (RT2-04).
 */
export function digitosTelefone(valor: string): string {
  const comMais = /^\s*\+/.test(valor);
  let digitos = valor.replace(/\D/g, '');
  if (comMais && digitos.startsWith('55')) {
    digitos = digitos.slice(2);
  } else if (!comMais && digitos.startsWith('0055')) {
    digitos = digitos.slice(4);
  }
  // Um único 0 antes de um DDD (que nunca começa com 0). "00..." não é
  // tirado: "00000000000" continua no campo e mostra o erro de DDD.
  if (/^0[1-9]/.test(digitos)) digitos = digitos.slice(1);
  return digitos.slice(0, DIGITOS_MAXIMOS_NO_CAMPO);
}

/**
 * Formata uma entrada de telefone com DDD enquanto o usuário digita:
 * "(00) 00000-0000" para celular (11 dígitos) e "(00) 0000-0000" para fixo
 * (10 dígitos). Com dígitos demais, eles continuam no fim para a pessoa ver o
 * que sobrou (a validação acusa o erro).
 */
export function formatarTelefone(valor: string): string {
  // Um "+" digitado sozinho (ou "+5") fica no campo até completar o "+55";
  // um número de outro país também fica como veio, para a validação recusar.
  const comMais = /^\s*\+/.test(valor);
  const brutos = valor.replace(/\D/g, '');
  if (comMais && (brutos.length < 2 ? '55'.startsWith(brutos) : !brutos.startsWith('55'))) {
    return `+${brutos.slice(0, DIGITOS_MAXIMOS_NO_CAMPO)}`;
  }

  const digitos = digitosTelefone(valor);
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

/**
 * Mesma regra da API: 10 ou 11 dígitos, DDD de 11 a 99 e, com 11 dígitos,
 * o terceiro é 9. Devolve a mensagem de erro ou null.
 */
export function validarTelefone(valor: string): string | null {
  if (/^\s*\+/.test(valor)) return 'Informe um telefone do Brasil: DDD + número (o +55 é opcional).';
  const digitos = valor.replace(/\D/g, '');
  if (digitos.length > 11) return 'Telefone com dígitos demais. Informe DDD + número, com 10 ou 11 dígitos.';
  if (digitos.length !== 10 && digitos.length !== 11) {
    return 'Informe o telefone com DDD: 10 dígitos para fixo ou 11 para celular.';
  }
  const ddd = Number(digitos.slice(0, 2));
  if (ddd < 11) return 'O DDD do telefone precisa estar entre 11 e 99.';
  if (digitos.length === 11 && digitos[2] !== '9') {
    return 'Celular com 11 dígitos precisa começar com 9 depois do DDD.';
  }
  return null;
}
