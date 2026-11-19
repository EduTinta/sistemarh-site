// Aviso do navegador ao recarregar (F5) ou fechar a aba enquanto um envio
// ainda não respondeu (V2-02). Sem ele, o cadastro era gravado, a tela voltava
// vazia e quem tentava de novo recebia 409 sem entender o motivo.
//
// A trava acompanha a REQUISIÇÃO, e não a tela: quem sai da tela no meio do
// envio (o resultado chega pelo aviso global) continua protegido se der F5
// antes da resposta. A troca de tela dentro do painel não pergunta nada,
// porque ali o resultado não se perde.

let enviosEmAndamento = 0;

function antesDeSair(evento: BeforeUnloadEvent) {
  evento.preventDefault();
  // Navegadores mais antigos só perguntam com o returnValue preenchido.
  evento.returnValue = '';
}

/**
 * Marca o começo de um envio. Devolve a função que marca o fim; chame-a no
 * `finally` do envio (chamar mais de uma vez não tem efeito).
 */
export function marcarEnvioEmAndamento(): () => void {
  if (enviosEmAndamento === 0) window.addEventListener('beforeunload', antesDeSair);
  enviosEmAndamento++;
  let encerrado = false;
  return () => {
    if (encerrado) return;
    encerrado = true;
    enviosEmAndamento--;
    if (enviosEmAndamento === 0) window.removeEventListener('beforeunload', antesDeSair);
  };
}
