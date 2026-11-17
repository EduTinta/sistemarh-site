import { useMemo, useState } from 'react';
import { DollarSign, Save, TrendingUp, Calendar, Loader2 } from 'lucide-react';
import { api, ApiError } from '../../services/api';
import { useAuth } from '../context/AuthContext';
import { useFuncionarios } from '../hooks/useFuncionarios';
import { StatusFuncionario, type FuncionarioDto } from '../../types/api';
import { ListaColaboradores } from './ListaColaboradores';
import { arredondarCentavos, formatarMoeda, lerValor } from '../../utils/moeda';
import { formatarDataCalendario, hojeEmBrasilia } from '../../utils/datas';
import { iniciais } from '../../utils/funcionarios';

type TipoAjuste = 'percentual' | 'fixo';

const TAMANHO_MINIMO_MOTIVO = 3;

function calcularNovoSalario(salarioAtual: number, tipo: TipoAjuste, valor: number): number {
  return arredondarCentavos(tipo === 'percentual' ? salarioAtual * (1 + valor / 100) : salarioAtual + valor);
}

export function SalaryAdjustment() {
  const { token } = useAuth();
  const { funcionarios, carregando, erro, recarregar, substituir } = useFuncionarios();
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [tipoAjuste, setTipoAjuste] = useState<TipoAjuste>('percentual');
  const [valorAjusteTexto, setValorAjusteTexto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [dataVigencia, setDataVigencia] = useState(hojeEmBrasilia);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  // Ajuste salarial só faz sentido pra quem ainda está na empresa.
  const ativos = useMemo(() => funcionarios.filter((f) => f.status === StatusFuncionario.Ativo), [funcionarios]);
  const selecionado = ativos.find((f) => f.id === selecionadoId) ?? null;

  const valorAjuste = lerValor(valorAjusteTexto);
  const novoSalario = selecionado && valorAjuste !== null ? calcularNovoSalario(selecionado.salario, tipoAjuste, valorAjuste) : null;
  const diferenca = selecionado && novoSalario !== null ? novoSalario - selecionado.salario : 0;

  function handleSelecionar(funcionario: FuncionarioDto) {
    setSelecionadoId(funcionario.id);
    setValorAjusteTexto('');
    setMotivo('');
    setDataVigencia(hojeEmBrasilia());
    setErroSalvar(null);
    setSucesso(null);
  }

  async function handleSalvar() {
    if (!token || !selecionado) return;
    setErroSalvar(null);
    setSucesso(null);

    if (valorAjuste === null || valorAjuste === 0) {
      setErroSalvar('Informe o valor do ajuste.');
      return;
    }
    if (novoSalario === null || novoSalario <= 0) {
      setErroSalvar('O novo salário precisa ser maior que zero.');
      return;
    }
    if (!dataVigencia) {
      setErroSalvar('Informe a data de vigência.');
      return;
    }
    const motivoLimpo = motivo.trim();
    if (motivoLimpo.length < TAMANHO_MINIMO_MOTIVO) {
      setErroSalvar(`Descreva o motivo do ajuste (mínimo de ${TAMANHO_MINIMO_MOTIVO} caracteres).`);
      return;
    }

    setSalvando(true);
    try {
      const atualizado = await api.ajustarSalario(token, selecionado.id, {
        novoSalario,
        dataVigencia,
        motivo: motivoLimpo,
      });
      substituir(atualizado);
      setSucesso(
        `Ajuste salarial de ${atualizado.nome} registrado: de ${formatarMoeda(selecionado.salario)} para ${formatarMoeda(novoSalario)}, com vigência em ${formatarDataCalendario(dataVigencia)}.`
      );
      setValorAjusteTexto('');
      setMotivo('');
    } catch (e) {
      setErroSalvar(e instanceof ApiError ? e.message : 'Não foi possível aplicar o ajuste salarial.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto animate-fade-in">
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <DollarSign className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
          </div>
          <h1 className="text-2xl sm:text-3xl">Ajuste Salarial</h1>
        </div>
        <p className="text-sm sm:text-base text-muted-foreground">
          Gerencie e aplique ajustes salariais para os colaboradores
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Lista de Colaboradores */}
        <ListaColaboradores
          funcionarios={ativos}
          carregando={carregando}
          erro={erro}
          onRecarregar={recarregar}
          selecionadoId={selecionadoId}
          onSelecionar={handleSelecionar}
          mensagemVazia="Nenhum colaborador ativo cadastrado."
          renderItem={(funcionario) => (
            <>
              <h3 className="font-medium mb-1 break-words">{funcionario.nome}</h3>
              <p className="text-sm text-muted-foreground mb-2 break-all">{funcionario.email ?? 'Sem e-mail'}</p>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                <div className="flex gap-2 flex-wrap">
                  <span className="text-xs px-2 py-1 bg-accent rounded-full">{funcionario.departamentoNome}</span>
                  <span className="text-xs px-2 py-1 bg-accent rounded-full">{funcionario.cargoNome}</span>
                </div>
                <span className="text-sm font-medium text-primary whitespace-nowrap">
                  {formatarMoeda(funcionario.salario)}
                </span>
              </div>
            </>
          )}
        />

        {/* Formulário de Ajuste */}
        <div className="hr-card p-4 sm:p-6">
          <h2 className="text-xl mb-4">Aplicar Ajuste Salarial</h2>

          {selecionado ? (
            <div className="space-y-6">
              {/* Informações do Colaborador */}
              <div className="p-4 bg-accent/30 rounded-lg border border-border">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center text-primary-foreground shrink-0">
                    {iniciais(selecionado.nome)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium break-words">{selecionado.nome}</h3>
                    <p className="text-sm text-muted-foreground break-words">{selecionado.cargoNome}</p>
                  </div>
                </div>
                <div className="flex flex-wrap justify-between items-center gap-2 mt-3 pt-3 border-t border-border">
                  <span className="text-sm text-muted-foreground">Salário Atual</span>
                  <span className="text-lg font-medium text-primary">{formatarMoeda(selecionado.salario)}</span>
                </div>
              </div>

              {/* Tipo de Ajuste */}
              <div>
                <label className="block text-sm font-medium mb-2">Tipo de Ajuste</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTipoAjuste('percentual')}
                    className={`p-3 rounded-lg border transition-all ${
                      tipoAjuste === 'percentual'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-accent/30 hover:bg-accent/50'
                    }`}
                  >
                    Percentual (%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoAjuste('fixo')}
                    className={`p-3 rounded-lg border transition-all ${
                      tipoAjuste === 'fixo'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-accent/30 hover:bg-accent/50'
                    }`}
                  >
                    Valor Fixo (R$)
                  </button>
                </div>
              </div>

              {/* Valor do Ajuste */}
              <div>
                <label htmlFor="valorAjuste" className="block text-sm font-medium mb-2">
                  Valor do Ajuste {tipoAjuste === 'percentual' ? '(%)' : '(R$)'}
                </label>
                <div className="relative">
                  <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    id="valorAjuste"
                    type="number"
                    step="0.01"
                    value={valorAjusteTexto}
                    onChange={(e) => setValorAjusteTexto(e.target.value)}
                    placeholder={tipoAjuste === 'percentual' ? 'Ex: 10' : 'Ex: 1000'}
                    className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Data de Vigência */}
              <div>
                <label htmlFor="dataVigencia" className="block text-sm font-medium mb-2">
                  Data de Vigência
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    id="dataVigencia"
                    type="date"
                    value={dataVigencia}
                    onChange={(e) => setDataVigencia(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Motivo */}
              <div>
                <label htmlFor="motivoAjuste" className="block text-sm font-medium mb-2">
                  Motivo do Ajuste
                </label>
                <textarea
                  id="motivoAjuste"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Descreva o motivo do ajuste salarial..."
                  rows={3}
                  className="w-full px-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>

              {/* Prévia do Novo Salário */}
              {novoSalario !== null && (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <h4 className="font-medium mb-3">Prévia do Ajuste</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-muted-foreground">Salário Atual:</span>
                      <span>{formatarMoeda(selecionado.salario)}</span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-muted-foreground">Ajuste:</span>
                      <span className={diferenca >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {diferenca >= 0 ? '+' : '-'} {formatarMoeda(Math.abs(diferenca))}
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-border">
                      <span className="font-medium">Novo Salário:</span>
                      <span className="font-medium text-primary text-lg">{formatarMoeda(novoSalario)}</span>
                    </div>
                  </div>
                </div>
              )}

              {erroSalvar && (
                <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">{erroSalvar}</div>
              )}
              {sucesso && (
                <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
                  {sucesso}
                </div>
              )}

              {/* Botão Salvar */}
              <button
                type="button"
                onClick={handleSalvar}
                disabled={salvando}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>Aplicar Ajuste Salarial</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <DollarSign className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-center">Selecione um colaborador ao lado para aplicar ajuste salarial</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
