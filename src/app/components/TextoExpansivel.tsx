import { useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * Texto longo (descrição de justificativa, mensagem, resposta, motivo) com
 * altura máxima e "Ver mais / Ver menos". Sem isso, um texto com centenas de
 * quebras de linha virava um card de 20.000 px e empurrava todos os outros
 * para baixo. As quebras de linha continuam (`whitespace-pre-line`) e uma
 * palavra longa sem espaço quebra dentro do card.
 */
export function TextoExpansivel({
  texto,
  className = '',
  alturaMaxima = 160,
}: {
  texto: string;
  className?: string;
  /** Em px, contando o padding do parágrafo. */
  alturaMaxima?: number;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [transborda, setTransborda] = useState(false);

  // O botão só aparece se o texto passa da altura máxima (mede de novo
  // quando a largura muda, porque a quebra de linha muda junto).
  useLayoutEffect(() => {
    const paragrafo = ref.current;
    if (!paragrafo) return;
    const medir = () => setTransborda(paragrafo.scrollHeight > alturaMaxima + 1);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(paragrafo);
    return () => observador.disconnect();
  }, [texto, alturaMaxima]);

  return (
    <div className="min-w-0">
      <p
        id={id}
        ref={ref}
        className={`whitespace-pre-line [overflow-wrap:anywhere] ${aberto ? '' : 'overflow-hidden'} ${className}`}
        style={aberto ? undefined : { maxHeight: alturaMaxima }}
      >
        {texto}
      </p>
      {transborda && (
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          aria-controls={id}
          className="mt-1 text-sm text-primary hover:underline"
        >
          {aberto ? 'Ver menos' : 'Ver mais'}
        </button>
      )}
    </div>
  );
}
