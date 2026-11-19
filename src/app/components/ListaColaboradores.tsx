import { useMemo, useState, type ReactNode } from 'react';
import { Search, Loader2, RefreshCw, Users } from 'lucide-react';
import type { FuncionarioDto } from '../../types/api';
import { contarColaboradores, filtrarFuncionarios, ordenarPorNome } from '../../utils/funcionarios';
import { limparTexto } from '../../utils/validacao';

interface ListaColaboradoresProps {
  funcionarios: FuncionarioDto[];
  carregando: boolean;
  erro: string | null;
  onRecarregar: () => void;
  selecionadoId: number | null;
  onSelecionar: (funcionario: FuncionarioDto) => void;
  /** Conteúdo de cada item (o botão em volta e o destaque do selecionado ficam aqui). */
  renderItem: (funcionario: FuncionarioDto) => ReactNode;
  titulo?: string;
  /** Controles extras (ex. filtros) mostrados logo abaixo da busca. */
  filtros?: ReactNode;
  mensagemVazia?: string;
  /**
   * Texto da busca, quando quem usa a lista precisa dele (ex. para contar os
   * resultados nos filtros). Sem essas duas props, a lista guarda a busca sozinha.
   */
  busca?: string;
  onBuscaChange?: (busca: string) => void;
}

/**
 * Card "Buscar Colaborador" usado nas telas de colaboradores: mostra a lista
 * inteira de cara, ordenada por nome, e a busca só filtra.
 */
export function ListaColaboradores({
  funcionarios,
  carregando,
  erro,
  onRecarregar,
  selecionadoId,
  onSelecionar,
  renderItem,
  titulo = 'Buscar Colaborador',
  filtros,
  mensagemVazia = 'Nenhum colaborador cadastrado.',
  busca: buscaControlada,
  onBuscaChange,
}: ListaColaboradoresProps) {
  const [buscaInterna, setBuscaInterna] = useState('');
  const busca = buscaControlada ?? buscaInterna;
  const setBusca = onBuscaChange ?? setBuscaInterna;
  const buscaExibida = limparTexto(busca);

  const visiveis = useMemo(() => ordenarPorNome(filtrarFuncionarios(funcionarios, busca)), [funcionarios, busca]);

  return (
    // min-w-0: como item de grid, o card não pode crescer com um texto longo sem espaço.
    <div className="hr-card p-4 sm:p-6 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-4">
        <h2 className="text-xl">{titulo}</h2>
        {!carregando && !erro && (
          <span className="text-sm text-muted-foreground whitespace-nowrap">{contarColaboradores(visiveis.length)}</span>
        )}
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, e-mail, CPF, departamento ou cargo..."
          aria-label="Buscar colaborador por nome, e-mail, CPF, departamento ou cargo"
          maxLength={200}
          className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {filtros && <div className="mb-4">{filtros}</div>}

      <div className="mt-6">
        {carregando ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Carregando colaboradores…
          </div>
        ) : erro ? (
          <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <p className="m-0">{erro}</p>
            <button
              onClick={onRecarregar}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:underline"
            >
              <RefreshCw size={14} />
              Tentar novamente
            </button>
          </div>
        ) : visiveis.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-center">
            <Users className="w-10 h-10 mb-3 opacity-50" />
            <p className="m-0 text-sm max-w-full [overflow-wrap:anywhere]">
              {buscaExibida ? `Nenhum colaborador encontrado para "${buscaExibida}".` : mensagemVazia}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] sm:max-h-[600px] overflow-y-auto">
            {visiveis.map((funcionario) => (
              <button
                key={funcionario.id}
                onClick={() => onSelecionar(funcionario)}
                className={`w-full min-w-0 p-3 sm:p-4 rounded-lg border transition-all text-left ${
                  selecionadoId === funcionario.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-accent/30 hover:bg-accent/50'
                }`}
              >
                {renderItem(funcionario)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
