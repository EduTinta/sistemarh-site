import { useEffect, useRef } from 'react';

/**
 * Diz se a tela ainda está aberta. Um envio que termina depois que a pessoa
 * saiu da tela não tem onde mostrar o resultado: nesse caso a tela usa o
 * aviso global (`avisarGlobal`) em vez do aviso dela.
 */
export function useMontado() {
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  return montado;
}
