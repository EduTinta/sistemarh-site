import { useMemo, useState, useRef } from 'react';
import { DollarSign, Save, TrendingUp, Calendar, Loader2 } from 'lucide-react';
import { api, ApiError, ehConflito } from '../../services/api';
import { useAuth } from '../context/AuthContext';
import { useFuncionarios } from '../hooks/useFuncionarios';
import { useEnvioPorColaborador } from '../hooks/useEnvioPorColaborador';
import { useDevolverFocoAoTerminar } from '../hooks/useDevolverFoco';
import { useConfirmarSaida } from '../context/AvisosContext';
import { StatusFuncionario, type FuncionarioDto } from '../../types/api';
import { ListaColaboradores } from './ListaColaboradores';
import {
  PERCENTUAL_MAXIMO,
  PERCENTUAL_MINIMO,
  arredondarCentavos,
  formatarMoeda,
  formatarPercentual,
  lerPercentual,
  lerValorMonetario,
  mensagemConfirmacaoVariacao,
  pedeConfirmacao,
  previaMonetaria,
  validarSalario,
} from '../../utils/moeda';
import { dataIso, formatarDataCalendario, hojeEmBrasilia } from '../../utils/datas';
import { iniciais } from '../../utils/funcionarios';
import { MOTIVO_MAXIMO, contarCaracteres, limparTextoLongo, validarMotivo, validarVigencia, vigenciaMaxima } from '../../utils/validacao';

type TipoAjuste = 'percentual' | 'fixo';

function calcularNovoSalario(salarioAtual: number, tipo: TipoAjuste, valor: number): number {
  return arredondarCentavos(tipo === 'percentual' ? salarioAtual * (1 + valor / 100) : salarioAtual + valor);
}

function percentualNaFaixa(valor: number): boolean {
  return Number.isFinite(valor) && valor >= PERCENTUAL_MINIMO && valor <= PERCENTUAL_MAXIMO;
}

export function SalaryAdjustment() {
  const { token } = useAuth();
  const { funcionarios, carregando, erro, recarregar, substituir } = useFuncionarios();
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [tipoAjuste, setTipoAjuste] = useState<TipoAjuste>('percentual');
  const [valorAjusteTexto, setValorAjusteTexto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [dataVigencia, setDataVigencia] = useState(hojeEmBrasilia);
  // Resultado do último envio por colaborador, trava e indicador de "salvando".
  const envio = useEnvioPorColaborador(selecionadoId);
  // O máximo conta todos os code points, como a API (o contador "x/500").
  const tamanhoMotivo = contarCaracteres(limparTextoLongo(motivo));
  const motivoLongoDemais = tamanhoMotivo > MOTIVO_MAXIMO;
  // Quando o envio termina, o foco vai para o aviso do resultado (ou para o
  // botão), em vez de ficar perdido no BODY com o botão desabilitado (V5-01).
  const resultadoRef = useRef<HTMLDivElement>(null);
  const botaoAplicarRef = useRef<HTMLButtonElement>(null);
  // Só quando o envio que terminou é do colaborador na tela (V6-03).
  useDevolverFocoAoTerminar(envio.salvandoId, selecionadoId, [resultadoRef, botaoAplicarRef]);

  // Ajuste salarial só faz sentido pra quem ainda está na empresa.
  const ativos = useMemo(() => funcionarios.filter((f) => f.status === StatusFuncionario.Ativo), [funcionarios]);
  const selecionado = ativos.find((f) => f.id === selecionadoId) ?? null;
  const admissao = dataIso(selecionado?.dataAdmissao);
  const vigenciaLimite = vigenciaMaxima(admissao);
  const admissaoFutura = admissao !== null && admissao > hojeEmBrasilia();

  // Sair da tela com um ajuste digitado e não enviado pede confirmação. Durante
  // o envio não: o resultado chega pelo aviso global.
  useConfirmarSaida(!envio.salvando && (valorAjusteTexto.trim() !== '' || motivo.trim() !== ''));

  const valorAjuste = tipoAjuste === 'percentual' ? lerPercentual(valorAjusteTexto) : lerValorMonetario(valorAjusteTexto);
  const valorAjusteValido = valorAjuste !== null && (tipoAjuste === 'fixo' || percentualNaFaixa(valorAjuste));
  const novoSalario =
    selecionado && valorAjusteValido ? calcularNovoSalario(selecionado.salario, tipoAjuste, valorAjuste) : null;
  const diferenca = selecionado && novoSalario !== null ? novoSalario - selecionado.salario : 0;

  // Prévia junto do campo: mostra como o valor digitado foi entendido.
  const previaCampo = (() => {
    if (!valorAjusteTexto.trim()) return null;
    if (tipoAjuste === 'fixo') return previaMonetaria(valorAjusteTexto);
    if (valorAjuste === null) return { texto: 'Percentual inválido. Use, por exemplo, 10 ou 10,5.', valido: false };
    if (!percentualNaFaixa(valorAjuste)) {
      return {
        texto: `O percentual precisa estar entre ${formatarPercentual(PERCENTUAL_MINIMO)} e +${formatarPercentual(PERCENTUAL_MAXIMO)}.`,
        valido: false,
      };
    }
    return { texto: `= ${valorAjuste > 0 ? '+' : ''}${formatarPercentual(valorAjuste)}`, valido: true };
  })();

  const avisoAtual = envio.resultadoAtual;

  // A vigência começa no último dia aceito: hoje, ou a própria admissão para
  // quem ainda vai ser admitido.
  function limparFormulario(funcionario: FuncionarioDto) {
    setValorAjusteTexto('');
    setMotivo('');
    setDataVigencia(vigenciaMaxima(dataIso(funcionario.dataAdmissao)));
  }

  // O resultado do último envio de cada colaborador não é apagado aqui: ele
  // volta a aparecer quando o colaborador é selecionado de novo.
  function handleSelecionar(funcionario: FuncionarioDto) {
    if (funcionario.id === selecionadoId) return;
    setSelecionadoId(funcionario.id);
    limparFormulario(funcionario);
  }

  function handleTipoAjuste(tipo: TipoAjuste) {
    // "10" em percentual e "10" em reais são ajustes bem diferentes: troca de
    // tipo começa com o campo vazio.
    if (tipo !== tipoAjuste) setValorAjusteTexto('');
    setTipoAjuste(tipo);
  }

  async function handleSalvar() {
    if (!token || !selecionado || envio.salvando) return;
    const alvo = selecionado;
    const erroDe = (mensagem: string) => envio.erroDeValidacao(alvo.id, mensagem);

    if (valorAjuste === null) {
      erroDe(
        !valorAjusteTexto.trim()
          ? 'Informe o valor do ajuste.'
          : tipoAjuste === 'percentual'
            ? 'Percentual inválido. Use, por exemplo, 10 ou 10,5.'
            : 'Valor do ajuste inválido. Use o formato 1.234,56.'
      );
      return;
    }
    if (valorAjuste === 0) {
      erroDe('Informe um valor de ajuste diferente de zero.');
      return;
    }
    if (!valorAjusteValido || novoSalario === null) {
      erroDe(
        `O percentual precisa estar entre ${formatarPercentual(PERCENTUAL_MINIMO)} e +${formatarPercentual(PERCENTUAL_MAXIMO)}.`
      );
      return;
    }
    const erroSalario = validarSalario(novoSalario, 'o novo salário');
    if (erroSalario) {
      erroDe(erroSalario);
      return;
    }
    if (novoSalario === alvo.salario) {
      erroDe('O novo valor é igual ao atual.');
      return;
    }
    const erroVigencia = validarVigencia(dataVigencia, dataIso(alvo.dataAdmissao));
    if (erroVigencia) {
      erroDe(erroVigencia);
      return;
    }
    // Mesmas mensagens da API ("O motivo…", "Informe o motivo do ajuste.").
    const erroMotivo = validarMotivo(motivo);
    if (erroMotivo) {
      // Acima do limite, a mesma mensagem já está embaixo do campo: não repete
      // e apaga o resultado anterior desse colaborador, que já não vale (V6-01).
      if (motivoLongoDemais) {
        envio.limparResultado(alvo.id);
        document.getElementById('motivoAjuste')?.focus();
      } else {
        erroDe(erroMotivo);
      }
      return;
    }
    if (
      pedeConfirmacao(alvo.salario, novoSalario) &&
      !window.confirm(mensagemConfirmacaoVariacao(`O salário de ${alvo.nome}`, alvo.salario, novoSalario))
    ) {
      return;
    }

    if (!envio.iniciar(alvo.id)) return;
    try {
      const atualizado = await api.ajustarSalario(token, alvo.id, {
        novoSalario,
        dataVigencia,
        // Mantém as quebras de linha (no máximo 2 seguidas), como a API grava.
        motivo: limparTextoLongo(motivo),
        // A API recusa com 409 se o salário mudou depois que a tela carregou.
        versao: alvo.versao,
      });
      substituir(atualizado);
      envio.concluir(alvo.id, {
        tipo: 'sucesso',
        mensagem: `Ajuste salarial de ${atualizado.nome} registrado: de ${formatarMoeda(alvo.salario)} para ${formatarMoeda(atualizado.salario)}, com vigência em ${formatarDataCalendario(dataVigencia)}.`,
      });
      if (envio.aindaSelecionado(alvo.id)) limparFormulario(alvo);
    } catch (e) {
      const motivoErro = e instanceof ApiError ? e.message : 'Não foi possível aplicar o ajuste salarial.';
      // Num 409 outra pessoa alterou o cadastro: recarrega para o cálculo
      // partir do salário real.
      if (ehConflito(e)) recarregar();
      const mensagem = ehConflito(e)
        ? `${motivoErro} Os dados foram recarregados; confira o salário atual antes de aplicar de novo.`
        : motivoErro;
      envio.concluir(alvo.id, { tipo: 'erro', mensagem }, `O ajuste salarial de ${alvo.nome} não foi aplicado: ${motivoErro}`);
    } finally {
      envio.encerrar();
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
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="font-medium break-words [overflow-wrap:anywhere] min-w-0">{funcionario.nome}</h3>
                {envio.salvandoId === funcionario.id && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-xs text-primary" role="status">
                    <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                    Salvando…
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mb-2 break-all">{funcionario.email ?? 'Sem e-mail'}</p>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                <div className="flex gap-2 flex-wrap min-w-0">
                  <span className="text-xs px-2 py-1 bg-accent rounded-full max-w-full [overflow-wrap:anywhere]">
                    {funcionario.departamentoNome}
                  </span>
                  <span className="text-xs px-2 py-1 bg-accent rounded-full max-w-full [overflow-wrap:anywhere]">
                    {funcionario.cargoNome}
                  </span>
                </div>
                <span className="text-sm font-medium text-primary whitespace-nowrap shrink-0">
                  {formatarMoeda(funcionario.salario)}
                </span>
              </div>
            </>
          )}
        />

        {/* Formulário de Ajuste */}
        <div className="hr-card p-4 sm:p-6 min-w-0">
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
                    <h3 className="font-medium break-words [overflow-wrap:anywhere]">{selecionado.nome}</h3>
                    <p className="text-sm text-muted-foreground break-words [overflow-wrap:anywhere]">
                      {selecionado.cargoNome}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap justify-between items-center gap-2 mt-3 pt-3 border-t border-border">
                  <span className="text-sm text-muted-foreground">Salário Atual</span>
                  <span className="text-lg font-medium text-primary">{formatarMoeda(selecionado.salario)}</span>
                </div>
              </div>

              {/* Tipo de Ajuste */}
              <div>
                <p id="tipoAjusteRotulo" className="block text-sm font-medium mb-2">
                  Tipo de Ajuste
                </p>
                <div className="grid grid-cols-2 gap-3" role="group" aria-labelledby="tipoAjusteRotulo">
                  <button
                    type="button"
                    onClick={() => handleTipoAjuste('percentual')}
                    aria-pressed={tipoAjuste === 'percentual'}
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
                    onClick={() => handleTipoAjuste('fixo')}
                    aria-pressed={tipoAjuste === 'fixo'}
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
                  {/* Texto, e não type=number: o number dependia do idioma do navegador e lia "1.000" como 1. */}
                  <input
                    id="valorAjuste"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={20}
                    value={valorAjusteTexto}
                    onChange={(e) => setValorAjusteTexto(e.target.value)}
                    placeholder={tipoAjuste === 'percentual' ? 'Ex: 10 ou 10,5 (use - para reduzir)' : 'Ex: 1.000,00 (use - para reduzir)'}
                    aria-describedby="valorAjustePrevia"
                    aria-invalid={previaCampo ? !previaCampo.valido : undefined}
                    className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <p
                  id="valorAjustePrevia"
                  aria-live="polite"
                  className={`mt-1.5 text-xs min-h-[1rem] ${previaCampo && !previaCampo.valido ? 'text-red-600' : 'text-muted-foreground'}`}
                >
                  {previaCampo?.texto ??
                    (tipoAjuste === 'percentual'
                      ? `Entre ${formatarPercentual(PERCENTUAL_MINIMO)} e +${formatarPercentual(PERCENTUAL_MAXIMO)}.`
                      : 'Valor somado ao salário atual, no formato 1.234,56.')}
                </p>
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
                    min={admissao ?? undefined}
                    max={vigenciaLimite}
                    onChange={(e) => setDataVigencia(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {admissaoFutura ? 'Admissão futura: a vigência é a própria data de admissão.' : 'Da admissão até hoje.'}
                </p>
              </div>

              {/* Motivo */}
              <div>
                <label htmlFor="motivoAjuste" className="block text-sm font-medium mb-2">
                  Motivo do Ajuste
                </label>
                <textarea
                  id="motivoAjuste"
                  aria-invalid={motivoLongoDemais || undefined}
                  aria-describedby="motivoAjuste-contagem"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Descreva o motivo do ajuste salarial..."
                  rows={3}
                  maxLength={MOTIVO_MAXIMO * 2}
                  className="w-full px-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                />
                {/* Acima do limite, o contador fica vermelho e o erro aparece na hora,
                    sem esperar o envio (V2-06). */}
                <p
                  id="motivoAjuste-contagem"
                  aria-live="polite"
                  className={`mt-1 text-xs text-right ${motivoLongoDemais ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}
                >
                  {tamanhoMotivo}/{MOTIVO_MAXIMO}
                  {motivoLongoDemais ? ` (${tamanhoMotivo - MOTIVO_MAXIMO} a mais)` : ''}
                </p>
                {motivoLongoDemais && (
                  <p role="alert" className="m-0 text-xs text-red-600">
                    O motivo pode ter no máximo {MOTIVO_MAXIMO} caracteres.
                  </p>
                )}
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
                      <span className="font-medium text-primary text-lg break-all">{formatarMoeda(novoSalario)}</span>
                    </div>
                  </div>
                </div>
              )}

              {avisoAtual?.tipo === 'erro' && (
                <div ref={resultadoRef} tabIndex={-1} role="alert" className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm break-words">
                  {avisoAtual.mensagem}
                </div>
              )}
              {avisoAtual?.tipo === 'sucesso' && (
                <div ref={resultadoRef} tabIndex={-1} role="status" className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm break-words [overflow-wrap:anywhere]">
                  {avisoAtual.mensagem}
                </div>
              )}

              {/* Botão Salvar */}
              <button
                type="button"
                ref={botaoAplicarRef}
                onClick={handleSalvar}
                disabled={envio.salvando}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {envio.salvandoId === selecionado.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
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
