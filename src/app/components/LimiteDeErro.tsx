import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Ocupa a tela toda (limite do topo, sem menu em volta). */
  telaInteira?: boolean;
  /**
   * Quando muda, um limite que está mostrando erro tenta de novo. Serve para
   * as abas que ficam montadas (ex.: Justificativas/Mensagens): voltar à aba
   * não deixa o erro antigo preso nela.
   */
  chaveReinicio?: unknown;
}

interface Estado {
  erro: Error | null;
}

/**
 * Segura um erro de renderização (ex.: a API respondeu algo fora do formato
 * e uma tela tentou fazer `.map` em undefined). Sem ele o React desmonta a
 * árvore inteira e o painel fica em branco, inclusive sem o menu.
 */
export class LimiteDeErro extends Component<Props, Estado> {
  state: Estado = { erro: null };

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error('Erro ao exibir a tela:', erro, info.componentStack);
  }

  componentDidUpdate(anteriores: Props) {
    if (this.state.erro && anteriores.chaveReinicio !== this.props.chaveReinicio) {
      this.setState({ erro: null });
    }
  }

  render() {
    if (!this.state.erro) return this.props.children;

    const conteudo = (
      <div role="alert" className="card-simples max-w-lg mx-auto text-center !py-8">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" aria-hidden="true" />
        <h2 className="m-0 mb-2 text-lg font-semibold text-gray-800">Não foi possível mostrar esta tela</h2>
        <p className="m-0 mb-5 text-sm text-gray-500">
          O servidor pode ter respondido algo inesperado. Tente de novo; se continuar, recarregue a página.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          {!this.props.telaInteira && (
            <button
              type="button"
              onClick={() => this.setState({ erro: null })}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <RefreshCw size={16} aria-hidden="true" />
              Tentar novamente
            </button>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Recarregar a página
          </button>
        </div>
      </div>
    );

    return this.props.telaInteira ? (
      <div className="min-h-screen w-full flex items-center justify-center bg-gray-100 p-4">{conteudo}</div>
    ) : (
      conteudo
    );
  }
}
