import { useMemo, useState, useRef } from 'react';
import { Utensils, Save, Calendar, Loader2 } from 'lucide-react';
import { api, ApiError, ehConflito } from '../../services/api';
import { useAuth } from '../context/AuthContext';
import { useFuncionarios } from '../hooks/useFuncionarios';
import { useEnvioPorColaborador } from '../hooks/useEnvioPorColaborador';
import { useDevolverFocoAoTerminar } from '../hooks/useDevolverFoco';
import { useConfirmarSaida } from '../context/AvisosContext';
import { StatusFuncionario, type FuncionarioDto } from '../../types/api';
import { ListaColaboradores } from './ListaColaboradores';
import {
  formatarMoeda,
  lerValorMonetario,
  mensagemConfirmacaoVariacao,
  pedeConfirmacao,
  previaMonetaria,
  validarVale,
} from '../../utils/moeda';
import { dataIso, formatarDataCalendario, hojeEmBrasilia } from '../../utils/datas';
import { iniciais } from '../../utils/funcionarios';
import { MOTIVO_MAXIMO, contarCaracteres, limparTextoLongo, validarMotivo, validarVigencia, vigenciaMaxima } from '../../utils/validacao';

interface Referencia {
  rotulo: string;
  valor: number;
}

// Resumo dos valores de vale em uso hoje. Substitui a tabela fixa que citava
// cargos que não existem no cadastro.
function calcularReferencias(ativos: FuncionarioDto[], selecionado: FuncionarioDto | null): Referencia[] {
  const valores = ativos.map((f) => f.valeAlimentacao).filter((v) => Number.isFinite(v));
  if (valores.length === 0) return [];
  const media = (lista: number[]) => lista.reduce((soma, v) => soma + v, 0) / lista.length;
  const referencias: Referencia[] = [
    { rotulo: `Média dos ${valores.length} colaboradores ativos`, valor: media(valores) },
    { rotulo: 'Menor valor atual', valor: Math.min(...valores) },
    { rotulo: 'Maior valor atual', valor: Math.max(...valores) },
  ];
  if (selecionado) {
    const mesmoCargo = ativos.filter((f) => f.cargoId === selecionado.cargoId).map((f) => f.valeAlimentacao);
    if (mesmoCargo.length > 1) {
      referencias.push({
        rotulo: `Média no cargo ${selecionado.cargoNome} (${mesmoCargo.length} pessoas)`,
        valor: media(mesmoCargo),
      });
    }
  }
  return referencias;
}

export function MealVoucherAdjustment() {
  const { token } = useAuth();
  const { funcionarios, carregando, erro, recarregar, substituir } = useFuncionarios();
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [novoValorTexto, setNovoValorTexto] = useState('');
  const [dataVigencia, setDataVigencia] = useState(hojeEmBrasilia);
  const [motivo, setMotivo] = useState('');
  // Resultado do último envio por colaborador, trava e indicador de "salvando"
  // (ver useEnvioPorColaborador).
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

  const ativos = useMemo(() => funcionarios.filter((f) => f.status === StatusFuncionario.Ativo), [funcionarios]);
  const selecionado = ativos.find((f) => f.id === selecionadoId) ?? null;
  const referencias = useMemo(() => calcularReferencias(ativos, selecionado), [ativos, selecionado]);
  const admissao = dataIso(selecionado?.dataAdmissao);
  const vigenciaLimite = vigenciaMaxima(admissao);
  const admissaoFutura = admissao !== null && admissao > hojeEmBrasilia();

  const novoValor = lerValorMonetario(novoValorTexto);
  const previa = previaMonetaria(novoValorTexto);
  const diferenca = selecionado && novoValor !== null ? novoValor - selecionado.valeAlimentacao : 0;
  const avisoAtual = envio.resultadoAtual;

  // Sair da tela com um ajuste digitado e não enviado pede confirmação.
  useConfirmarSaida(!envio.salvando && (novoValorTexto.trim() !== '' || motivo.trim() !== ''));

  // A vigência começa no último dia aceito: hoje, ou a própria admissão para
  // quem ainda vai ser admitido.
  function limparFormulario(funcionario: FuncionarioDto) {
    setNovoValorTexto('');
    setMotivo('');
    setDataVigencia(vigenciaMaxima(dataIso(funcionario.dataAdmissao)));
  }

  // O resultado do último envio de cada colaborador fica guardado e volta a
  // aparecer quando ele é selecionado de novo.
  function handleSelecionar(funcionario: FuncionarioDto) {
    if (funcionario.id === selecionadoId) return;
    setSelecionadoId(funcionario.id);
    limparFormulario(funcionario);
  }

  async function handleSalvar() {
    if (!token || !selecionado || envio.salvando) return;
    const alvo = selecionado;
    const erroDe = (mensagem: string) => envio.erroDeValidacao(alvo.id, mensagem);

    if (!novoValorTexto.trim()) {
      erroDe('Informe o novo valor do vale alimentação.');
      return;
    }
    const erroValor = validarVale(novoValor);
    if (erroValor || novoValor === null) {
      erroDe(erroValor ?? 'Informe o novo valor do vale alimentação.');
      return;
    }
    if (novoValor === alvo.valeAlimentacao) {
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
        document.getElementById('motivoVale')?.focus();
      } else {
        erroDe(erroMotivo);
      }
      return;
    }
    if (
      pedeConfirmacao(alvo.valeAlimentacao, novoValor) &&
      !window.confirm(
        mensagemConfirmacaoVariacao(`O vale alimentação de ${alvo.nome}`, alvo.valeAlimentacao, novoValor)
      )
    ) {
      return;
    }

    if (!envio.iniciar(alvo.id)) return;
    try {
      const atualizado = await api.ajustarValeAlimentacao(token, alvo.id, {
        novoValor,
        dataVigencia,
        // Mantém as quebras de linha (no máximo 2 seguidas), como a API grava.
        motivo: limparTextoLongo(motivo),
        versao: alvo.versao,
      });
      substituir(atualizado);
      envio.concluir(alvo.id, {
        tipo: 'sucesso',
        mensagem: `Vale alimentação de ${atualizado.nome} ajustado de ${formatarMoeda(alvo.valeAlimentacao)} para ${formatarMoeda(atualizado.valeAlimentacao)}, com vigência em ${formatarDataCalendario(dataVigencia)}.`,
      });
      if (envio.aindaSelecionado(alvo.id)) limparFormulario(alvo);
    } catch (e) {
      const motivoErro = e instanceof ApiError ? e.message : 'Não foi possível ajustar o vale alimentação.';
      if (ehConflito(e)) recarregar();
      const mensagem = ehConflito(e)
        ? `${motivoErro} Os dados foram recarregados; confira o valor atual antes de aplicar de novo.`
        : motivoErro;
      envio.concluir(alvo.id, { tipo: 'erro', mensagem }, `O vale alimentação de ${alvo.nome} não foi ajustado: ${motivoErro}`);
    } finally {
      envio.encerrar();
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto animate-fade-in">
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <Utensils className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
          </div>
          <h1 className="text-2xl sm:text-3xl">Vale Alimentação</h1>
        </div>
        <p className="text-sm sm:text-base text-muted-foreground">
          Gerencie e ajuste os valores de vale alimentação dos colaboradores
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
                  {formatarMoeda(funcionario.valeAlimentacao)}
                </span>
              </div>
            </>
          )}
        />

        {/* Formulário de Ajuste */}
        <div className="hr-card p-4 sm:p-6 min-w-0">
          <h2 className="text-xl mb-4">Aplicar Ajuste</h2>

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
                  <span className="text-sm text-muted-foreground">Vale Alimentação Atual</span>
                  <span className="text-lg font-medium text-primary">{formatarMoeda(selecionado.valeAlimentacao)}</span>
                </div>
              </div>

              {/* Novo Valor */}
              <div>
                <label htmlFor="novoValorVale" className="block text-sm font-medium mb-2">
                  Novo Valor (R$)
                </label>
                <div className="relative">
                  <Utensils className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  {/* Texto, e não type=number, para "1.000,00" ser lido como mil em qualquer navegador. */}
                  <input
                    id="novoValorVale"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={20}
                    value={novoValorTexto}
                    onChange={(e) => setNovoValorTexto(e.target.value)}
                    placeholder="Ex: 700,00"
                    aria-describedby="novoValorValePrevia"
                    aria-invalid={previa ? !previa.valido : undefined}
                    className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <p
                  id="novoValorValePrevia"
                  aria-live="polite"
                  className={`mt-1.5 text-xs min-h-[1rem] ${previa && !previa.valido ? 'text-red-600' : 'text-muted-foreground'}`}
                >
                  {previa?.texto ?? 'De R$ 0,00 a R$ 10.000,00, no formato 1.234,56.'}
                </p>
              </div>

              {/* Data de Vigência */}
              <div>
                <label htmlFor="dataVigenciaVale" className="block text-sm font-medium mb-2">
                  Data de Vigência
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    id="dataVigenciaVale"
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
                <label htmlFor="motivoVale" className="block text-sm font-medium mb-2">
                  Motivo do Ajuste
                </label>
                <textarea
                  id="motivoVale"
                  aria-invalid={motivoLongoDemais || undefined}
                  aria-describedby="motivoVale-contagem"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Descreva o motivo do ajuste..."
                  rows={3}
                  maxLength={MOTIVO_MAXIMO * 2}
                  className="w-full px-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                />
                {/* Acima do limite, o contador fica vermelho e o erro aparece na hora,
                    sem esperar o envio (V2-06). */}
                <p
                  id="motivoVale-contagem"
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

              {/* Prévia do Novo Valor */}
              {novoValor !== null && novoValor >= 0 && (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <h4 className="font-medium mb-3">Prévia do Ajuste</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-muted-foreground">Valor Atual:</span>
                      <span>{formatarMoeda(selecionado.valeAlimentacao)}</span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-muted-foreground">Diferença:</span>
                      <span className={diferenca >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {diferenca >= 0 ? '+' : '-'} {formatarMoeda(Math.abs(diferenca))}
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-border">
                      <span className="font-medium">Novo Valor:</span>
                      <span className="font-medium text-primary text-lg break-all">{formatarMoeda(novoValor)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Valores de Referência (dados reais dos colaboradores ativos) */}
              {referencias.length > 0 && (
                <div className="p-4 bg-accent/20 rounded-lg border border-border">
                  <h4 className="text-sm font-medium mb-2">Valores de Referência</h4>
                  <dl className="m-0 space-y-1 text-sm text-muted-foreground">
                    {referencias.map((ref) => (
                      <div key={ref.rotulo} className="flex flex-wrap justify-between gap-x-3">
                        <dt className="min-w-0 [overflow-wrap:anywhere]">{ref.rotulo}</dt>
                        <dd className="m-0 whitespace-nowrap">{formatarMoeda(ref.valor)}</dd>
                      </div>
                    ))}
                  </dl>
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
                <span>Aplicar Ajuste</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Utensils className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-center">Selecione um colaborador ao lado para ajustar o vale alimentação</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
