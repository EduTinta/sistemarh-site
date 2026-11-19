import { useEffect, useMemo, useState, useRef } from 'react';
import { TrendingUp, Save, Briefcase, DollarSign, Calendar, Loader2, RefreshCw, UserCheck, AlertTriangle } from 'lucide-react';
import { api, ApiError, ehConflito } from '../../services/api';
import { useAuth } from '../context/AuthContext';
import { useConfirmarSaida } from '../context/AvisosContext';
import { useFuncionarios } from '../hooks/useFuncionarios';
import { useEnvioPorColaborador } from '../hooks/useEnvioPorColaborador';
import { useDevolverFocoAoTerminar } from '../hooks/useDevolverFoco';
import { StatusFuncionario, type CargoDto, type DepartamentoDto, type FuncionarioDto } from '../../types/api';
import { ListaColaboradores } from './ListaColaboradores';
import {
  formatarMoeda,
  formatarValorEditavel,
  lerValorMonetario,
  mensagemConfirmacaoVariacao,
  pedeConfirmacao,
  previaMonetaria,
  validarSalario,
} from '../../utils/moeda';
import { dataIso, formatarDataCalendario, hojeEmBrasilia } from '../../utils/datas';
import { idsDaEquipe, iniciais, ordenarPorNome } from '../../utils/funcionarios';
import { itensComNome, salarioBaseDoCargo } from '../../utils/listas';
import { MOTIVO_MAXIMO, contarCaracteres, limparTextoLongo, validarMotivo, validarVigencia, vigenciaMaxima } from '../../utils/validacao';

const MENSAGEM_LISTA_INESPERADA = 'O servidor devolveu uma lista inesperada.';

function mensagemDeFalha(resultado: PromiseSettledResult<unknown>, padrao: string): string {
  if (resultado.status === 'rejected' && resultado.reason instanceof ApiError) return resultado.reason.message;
  return padrao;
}

export function Promotions() {
  const { token } = useAuth();
  const { funcionarios, carregando, erro, recarregar, substituir } = useFuncionarios();

  const [cargos, setCargos] = useState<CargoDto[]>([]);
  const [departamentos, setDepartamentos] = useState<DepartamentoDto[]>([]);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(true);
  const [erroOpcoes, setErroOpcoes] = useState<string | null>(null);
  const [versaoOpcoes, setVersaoOpcoes] = useState(0);

  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [novoCargoId, setNovoCargoId] = useState('');
  const [novoDepartamentoId, setNovoDepartamentoId] = useState('');
  const [novoGerenteId, setNovoGerenteId] = useState('');
  const [novoSalarioTexto, setNovoSalarioTexto] = useState('');
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

  // Cargos e departamentos pros selects (também buscados a cada abertura da
  // tela). Cada lista carrega por conta própria: a falha de uma não apaga a
  // outra. Sair da tela cancela os GETs, e uma lista fora do formato vira
  // erro com "Tentar novamente", em vez de travar em "Carregando…".
  useEffect(() => {
    if (!token) return;
    const controle = new AbortController();
    let cancelado = false;
    setCarregandoOpcoes(true);
    setErroOpcoes(null);

    Promise.allSettled([api.listarCargos(token, controle.signal), api.listarDepartamentos(token, controle.signal)])
      .then(([resCargos, resDeps]) => {
        if (cancelado) return;
        const falhas: string[] = [];
        const listaCargos = itensComNome<CargoDto>(resCargos.status === 'fulfilled' ? resCargos.value : null);
        if (resCargos.status === 'fulfilled' && listaCargos.valida) {
          setCargos(listaCargos.itens);
        } else {
          falhas.push(mensagemDeFalha(resCargos, `Não foi possível carregar os cargos. ${MENSAGEM_LISTA_INESPERADA}`));
        }
        const listaDeps = itensComNome<DepartamentoDto>(resDeps.status === 'fulfilled' ? resDeps.value : null);
        if (resDeps.status === 'fulfilled' && listaDeps.valida) {
          setDepartamentos(listaDeps.itens);
        } else {
          falhas.push(mensagemDeFalha(resDeps, `Não foi possível carregar os departamentos. ${MENSAGEM_LISTA_INESPERADA}`));
        }
        setErroOpcoes(falhas.length > 0 ? [...new Set(falhas)].join(' ') : null);
      })
      .catch(() => {
        if (!cancelado) setErroOpcoes('Não foi possível carregar cargos e departamentos.');
      })
      .finally(() => {
        if (!cancelado) setCarregandoOpcoes(false);
      });

    return () => {
      cancelado = true;
      controle.abort();
    };
  }, [token, versaoOpcoes]);

  const ativos = useMemo(() => funcionarios.filter((f) => f.status === StatusFuncionario.Ativo), [funcionarios]);
  const selecionado = ativos.find((f) => f.id === selecionadoId) ?? null;
  const admissao = dataIso(selecionado?.dataAdmissao);
  const vigenciaLimite = vigenciaMaxima(admissao);
  const admissaoFutura = admissao !== null && admissao > hojeEmBrasilia();

  const cargoEscolhido = cargos.find((c) => String(c.id) === novoCargoId) ?? null;
  const departamentoEscolhido = departamentos.find((d) => String(d.id) === novoDepartamentoId) ?? null;
  const mudaDepartamento = !!selecionado && !!departamentoEscolhido && departamentoEscolhido.id !== selecionado.departamentoId;
  const novoSalario = lerValorMonetario(novoSalarioTexto);
  const previaSalario = previaMonetaria(novoSalarioTexto);
  const diferencaSalario = selecionado && novoSalario !== null ? novoSalario - selecionado.salario : 0;
  // Sem sinal: o "+"/"-" já vai na frente do valor.
  const percentualVariacao = (
    selecionado && selecionado.salario > 0 ? Math.abs(diferencaSalario / selecionado.salario) * 100 : 0
  ).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const avisoAtual = envio.resultadoAtual;

  // Sair da tela com uma promoção preenchida e não enviada pede confirmação.
  const formularioAlterado =
    !!selecionado &&
    (novoCargoId !== '' ||
      novoGerenteId !== '' ||
      novoSalarioTexto.trim() !== '' ||
      motivo.trim() !== '' ||
      novoDepartamentoId !== String(selecionado.departamentoId));
  useConfirmarSaida(!envio.salvando && formularioAlterado);

  // Possíveis novos gestores: pessoas ativas, menos a própria pessoa e quem
  // está abaixo dela (fecharia um ciclo). Quem é do departamento de destino
  // aparece primeiro; os demais ficam disponíveis porque a Diretoria também
  // gerencia outros departamentos.
  const candidatosGestor = useMemo(() => {
    if (!selecionado) return { doDepartamento: [], outros: [] };
    const equipe = idsDaEquipe(funcionarios, selecionado.id);
    const elegiveis = ordenarPorNome(ativos.filter((f) => f.id !== selecionado.id && !equipe.has(f.id)));
    const departamentoDestino = departamentoEscolhido?.id ?? selecionado.departamentoId;
    return {
      doDepartamento: elegiveis.filter((f) => f.departamentoId === departamentoDestino),
      outros: elegiveis.filter((f) => f.departamentoId !== departamentoDestino),
    };
  }, [selecionado, funcionarios, ativos, departamentoEscolhido]);

  // Subordinados diretos que ficam no departamento antigo se a pessoa mudar de
  // departamento: a API os passa para o gestor anterior dela.
  const subordinadosDiretos = useMemo(
    () => (selecionado ? ativos.filter((f) => f.gerenteId === selecionado.id) : []),
    [selecionado, ativos]
  );
  const subordinadosQueFicam = mudaDepartamento
    ? subordinadosDiretos.filter((f) => f.departamentoId === selecionado!.departamentoId)
    : [];

  // O gestor atual pode estar desligado (cadastro antigo ou corrida com um
  // desligamento). Nesse caso a API não passa a equipe para ele: ela fica sem
  // gestor definido, e a tela precisa dizer isso (RT5-01).
  const gestorAtual = selecionado?.gerenteId ? funcionarios.find((f) => f.id === selecionado.gerenteId) ?? null : null;
  const gestorAtualDesligado = gestorAtual !== null && gestorAtual.status !== StatusFuncionario.Ativo;
  const nomeGestorAtual = selecionado?.gerenteNome
    ? `${selecionado.gerenteNome}${gestorAtualDesligado ? ' (desligado)' : ''}`
    : null;
  // Quem herda a equipe que fica no departamento antigo: o gestor atual, se ativo.
  const herdeiroDaEquipe = selecionado?.gerenteNome && !gestorAtualDesligado ? selecionado.gerenteNome : null;
  const gestorAtualForaDoDestino =
    mudaDepartamento &&
    !novoGerenteId &&
    gestorAtual !== null &&
    !gestorAtualDesligado &&
    gestorAtual.departamentoId !== departamentoEscolhido!.id;

  // A vigência começa no último dia aceito: hoje, ou a própria admissão para
  // quem ainda vai ser admitido.
  function limparFormulario(funcionario: FuncionarioDto) {
    setNovoCargoId('');
    setNovoDepartamentoId(String(funcionario.departamentoId));
    setNovoGerenteId('');
    setNovoSalarioTexto('');
    setDataVigencia(vigenciaMaxima(dataIso(funcionario.dataAdmissao)));
    setMotivo('');
  }

  // O resultado do último envio de cada colaborador fica guardado e volta a
  // aparecer quando ele é selecionado de novo.
  function handleSelecionar(funcionario: FuncionarioDto) {
    if (funcionario.id === selecionadoId) return;
    setSelecionadoId(funcionario.id);
    limparFormulario(funcionario);
  }

  // Ao escolher o cargo, sugere o salário base dele, mas nunca sobrescreve um
  // salário já digitado: só preenche com o campo vazio ou abaixo do atual.
  // Como promoção não reduz salário, a sugestão nunca fica abaixo do atual.
  function handleCargoChange(valor: string) {
    setNovoCargoId(valor);
    const cargo = cargos.find((c) => String(c.id) === valor);
    if (!cargo || !selecionado) return;
    const digitado = lerValorMonetario(novoSalarioTexto);
    if (!novoSalarioTexto.trim() || (digitado !== null && digitado < selecionado.salario)) {
      // Cargo sem salário base válido (resposta fora do contrato): sugere o atual.
      setNovoSalarioTexto(formatarValorEditavel(Math.max(salarioBaseDoCargo(cargo) ?? 0, selecionado.salario)));
    }
  }

  function handleDepartamentoChange(valor: string) {
    setNovoDepartamentoId(valor);
    // O gestor escolhido era sugerido para o departamento anterior.
    setNovoGerenteId('');
  }

  async function handleSalvar() {
    if (!token || !selecionado || envio.salvando) return;
    const alvo = selecionado;
    const erroDe = (mensagem: string) => envio.erroDeValidacao(alvo.id, mensagem);
    // Guardado agora: depois do envio, `selecionado` pode já ser outra pessoa.
    const herdeiro = herdeiroDaEquipe;

    if (!cargoEscolhido || !departamentoEscolhido) {
      erroDe('Selecione o novo cargo e o departamento.');
      return;
    }
    if (cargoEscolhido.id === alvo.cargoId && departamentoEscolhido.id === alvo.departamentoId) {
      erroDe(
        'A promoção precisa mudar o cargo ou o departamento. Para alterar só o salário, use Ajuste Salarial; para trocar só o gestor, edite o cadastro no Organograma.'
      );
      return;
    }
    const erroSalario = validarSalario(novoSalario, 'o novo salário');
    if (erroSalario || novoSalario === null) {
      erroDe(erroSalario ?? 'Informe o novo salário.');
      return;
    }
    if (novoSalario < alvo.salario) {
      erroDe('Promoção não pode reduzir o salário.');
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
        document.getElementById('justificativaPromocao')?.focus();
      } else {
        erroDe(erroMotivo);
      }
      return;
    }
    const gerenteEscolhido = novoGerenteId ? ativos.find((f) => String(f.id) === novoGerenteId) ?? null : null;
    if (novoGerenteId && !gerenteEscolhido) {
      erroDe('O gestor escolhido não está mais disponível. Escolha outro.');
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
      const { funcionario: atualizado, subordinadosRealocados } = await api.promoverFuncionario(token, alvo.id, {
        novoCargoId: cargoEscolhido.id,
        novoDepartamentoId: departamentoEscolhido.id,
        novoSalario,
        dataVigencia,
        // Mantém as quebras de linha (no máximo 2 seguidas), como a API grava.
        motivo: limparTextoLongo(motivo),
        // null mantém o gestor atual.
        novoGerenteId: gerenteEscolhido ? gerenteEscolhido.id : null,
        versao: alvo.versao,
      });
      substituir(atualizado);
      // Subordinados mudaram de gestor no backend: a lista precisa ser relida.
      if (subordinadosRealocados > 0) recarregar();

      const partes = [
        `Promoção de ${atualizado.nome} registrada: ${atualizado.cargoNome} em ${atualizado.departamentoNome}, com salário de ${formatarMoeda(atualizado.salario)} a partir de ${formatarDataCalendario(dataVigencia)}.`,
      ];
      if (gerenteEscolhido) partes.push(`Novo gestor direto: ${atualizado.gerenteNome ?? gerenteEscolhido.nome}.`);
      if (subordinadosRealocados > 0) {
        partes.push(
          `${subordinadosRealocados} subordinado(s) direto(s) do departamento anterior ${
            herdeiro ? `passaram para ${herdeiro}` : 'ficaram sem gestor definido'
          }.`
        );
      }
      envio.concluir(alvo.id, { tipo: 'sucesso', mensagem: partes.join(' ') });
      if (envio.aindaSelecionado(alvo.id)) limparFormulario(atualizado);
    } catch (e) {
      const motivoErro = e instanceof ApiError ? e.message : 'Não foi possível aplicar a promoção.';
      if (ehConflito(e)) recarregar();
      const mensagem = ehConflito(e)
        ? `${motivoErro} Os dados foram recarregados; confira a situação atual antes de aplicar de novo.`
        : motivoErro;
      envio.concluir(alvo.id, { tipo: 'erro', mensagem }, `A promoção de ${alvo.nome} não foi aplicada: ${motivoErro}`);
    } finally {
      envio.encerrar();
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto animate-fade-in">
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
          </div>
          <h1 className="text-2xl sm:text-3xl">Promoções</h1>
        </div>
        <p className="text-sm sm:text-base text-muted-foreground">
          Gerencie promoções e mudanças de cargo dos colaboradores
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
              <div className="flex flex-wrap gap-2 mb-2 min-w-0">
                <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full max-w-full [overflow-wrap:anywhere]">
                  {funcionario.cargoNome}
                </span>
                <span className="text-xs px-2 py-1 bg-accent rounded-full max-w-full [overflow-wrap:anywhere]">
                  {funcionario.departamentoNome}
                </span>
              </div>
              <div className="flex flex-wrap justify-between items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  Admissão: {formatarDataCalendario(funcionario.dataAdmissao) ?? '—'}
                </span>
                <span className="font-medium text-primary whitespace-nowrap">{formatarMoeda(funcionario.salario)}</span>
              </div>
            </>
          )}
        />

        {/* Formulário de Promoção */}
        <div className="hr-card p-4 sm:p-6 min-w-0">
          <h2 className="text-xl mb-4">Aplicar Promoção</h2>

          {selecionado ? (
            <div className="space-y-6">
              {/* Situação Atual */}
              <div className="p-4 bg-accent/30 rounded-lg border border-border">
                <h3 className="font-medium mb-3">Situação Atual</h3>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center text-primary-foreground shrink-0">
                    {iniciais(selecionado.nome)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-medium break-words [overflow-wrap:anywhere]">{selecionado.nome}</h4>
                    <p className="text-sm text-muted-foreground break-all">{selecionado.email ?? 'Sem e-mail'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-border">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-1">Cargo</p>
                    <p className="text-sm font-medium break-words [overflow-wrap:anywhere]">{selecionado.cargoNome}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-1">Departamento</p>
                    <p className="text-sm font-medium break-words [overflow-wrap:anywhere]">{selecionado.departamentoNome}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-1">Gestor direto</p>
                    <p className="text-sm font-medium break-words [overflow-wrap:anywhere]">
                      {nomeGestorAtual ?? 'Nenhum (topo da hierarquia)'}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-1">Salário Atual</p>
                    <p className="text-lg font-medium text-primary">{formatarMoeda(selecionado.salario)}</p>
                  </div>
                </div>
              </div>

              {erroOpcoes && (
                <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
                  <p className="m-0">{erroOpcoes}</p>
                  <button
                    type="button"
                    onClick={() => setVersaoOpcoes((v) => v + 1)}
                    className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:underline"
                  >
                    <RefreshCw size={14} />
                    Tentar novamente
                  </button>
                </div>
              )}

              {/* Novo Cargo */}
              <div>
                <label htmlFor="novoCargo" className="block text-sm font-medium mb-2">
                  Novo Cargo
                </label>
                <div className="relative">
                  <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <select
                    id="novoCargo"
                    value={novoCargoId}
                    onChange={(e) => handleCargoChange(e.target.value)}
                    disabled={carregandoOpcoes}
                    className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary appearance-none disabled:opacity-60 truncate"
                  >
                    <option value="">{carregandoOpcoes ? 'Carregando…' : 'Selecione um cargo'}</option>
                    {cargos.map((cargo) => (
                      <option key={cargo.id} value={cargo.id}>
                        {cargo.nome}
                        {cargo.id === selecionado.cargoId ? ' (atual)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {cargoEscolhido && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Salário base do cargo: {formatarMoeda(salarioBaseDoCargo(cargoEscolhido))}
                    {(salarioBaseDoCargo(cargoEscolhido) ?? Infinity) < selecionado.salario
                      ? ' (abaixo do salário atual, que é mantido como mínimo)'
                      : ''}
                  </p>
                )}
              </div>

              {/* Novo Departamento */}
              <div>
                <label htmlFor="novoDepartamento" className="block text-sm font-medium mb-2">
                  Departamento
                </label>
                <select
                  id="novoDepartamento"
                  value={novoDepartamentoId}
                  onChange={(e) => handleDepartamentoChange(e.target.value)}
                  disabled={carregandoOpcoes}
                  className="w-full px-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary appearance-none disabled:opacity-60 truncate"
                >
                  <option value="">{carregandoOpcoes ? 'Carregando…' : 'Selecione um departamento'}</option>
                  {departamentos.map((dep) => (
                    <option key={dep.id} value={dep.id}>
                      {dep.nome}
                      {dep.id === selecionado.departamentoId ? ' (atual)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Novo gestor (opcional) */}
              <div>
                <label htmlFor="novoGestor" className="block text-sm font-medium mb-2">
                  Novo gestor direto (opcional)
                </label>
                <div className="relative">
                  <UserCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <select
                    id="novoGestor"
                    value={novoGerenteId}
                    onChange={(e) => setNovoGerenteId(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary appearance-none truncate"
                  >
                    <option value="">
                      Manter o gestor atual ({nomeGestorAtual ?? 'nenhum, topo da hierarquia'})
                    </option>
                    {candidatosGestor.doDepartamento.length > 0 && (
                      <optgroup label={`Em ${departamentoEscolhido?.nome ?? selecionado.departamentoNome}`}>
                        {candidatosGestor.doDepartamento.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.nome} · {f.cargoNome}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {candidatosGestor.outros.length > 0 && (
                      <optgroup label="Outros departamentos">
                        {candidatosGestor.outros.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.nome} · {f.cargoNome} ({f.departamentoNome})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                {gestorAtualDesligado && !novoGerenteId && (
                  <p className="mt-1.5 text-xs text-amber-700 break-words [overflow-wrap:anywhere]">
                    O gestor atual ({gestorAtual!.nome}) está desligado. Escolha um novo gestor ativo acima.
                  </p>
                )}
                {gestorAtualForaDoDestino && (
                  <p className="mt-1.5 text-xs text-amber-700 break-words [overflow-wrap:anywhere]">
                    O gestor atual ({gestorAtual!.nome}) é de {gestorAtual!.departamentoNome}. Se a pessoa passa a
                    responder a outra liderança, escolha o novo gestor acima.
                  </p>
                )}
              </div>

              {/* Aviso sobre a equipe que fica no departamento antigo */}
              {subordinadosQueFicam.length > 0 && (
                <div className="flex gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <p className="m-0 min-w-0 break-words [overflow-wrap:anywhere]">
                    {selecionado.nome} tem {subordinadosQueFicam.length} subordinado(s) direto(s) em{' '}
                    {selecionado.departamentoNome}. Com a mudança de departamento,{' '}
                    {herdeiroDaEquipe
                      ? `eles passam para ${herdeiroDaEquipe}, gestor atual de ${selecionado.nome}`
                      : gestorAtualDesligado
                        ? `eles ficam sem gestor definido, porque o gestor atual de ${selecionado.nome} está desligado`
                        : 'eles ficam sem gestor definido'}
                    .
                  </p>
                </div>
              )}

              {/* Novo Salário */}
              <div>
                <label htmlFor="novoSalario" className="block text-sm font-medium mb-2">
                  Novo Salário (R$)
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  {/* Texto, e não type=number, para "15.000,00" ser lido como quinze mil em qualquer navegador. */}
                  <input
                    id="novoSalario"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={20}
                    value={novoSalarioTexto}
                    onChange={(e) => setNovoSalarioTexto(e.target.value)}
                    placeholder="Ex: 15.000,00"
                    aria-describedby="novoSalarioPrevia"
                    aria-invalid={previaSalario ? !previaSalario.valido : undefined}
                    className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <p
                  id="novoSalarioPrevia"
                  aria-live="polite"
                  className={`mt-1.5 text-xs min-h-[1rem] ${previaSalario && !previaSalario.valido ? 'text-red-600' : 'text-muted-foreground'}`}
                >
                  {previaSalario?.texto ?? 'Igual ou maior que o salário atual, no formato 1.234,56.'}
                </p>
              </div>

              {/* Data de Vigência */}
              <div>
                <label htmlFor="dataVigenciaPromocao" className="block text-sm font-medium mb-2">
                  Data de Vigência
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    id="dataVigenciaPromocao"
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

              {/* Justificativa */}
              <div>
                <label htmlFor="justificativaPromocao" className="block text-sm font-medium mb-2">
                  Justificativa da Promoção
                </label>
                <textarea
                  id="justificativaPromocao"
                  aria-invalid={motivoLongoDemais || undefined}
                  aria-describedby="justificativaPromocao-contagem"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Descreva os motivos e conquistas que justificam a promoção..."
                  rows={3}
                  maxLength={MOTIVO_MAXIMO * 2}
                  className="w-full px-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                />
                {/* Acima do limite, o contador fica vermelho e o erro aparece na hora,
                    sem esperar o envio (V2-06). */}
                <p
                  id="justificativaPromocao-contagem"
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

              {/* Prévia da Promoção */}
              {cargoEscolhido && novoSalario !== null && novoSalario > 0 && (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <h4 className="font-medium mb-3">Prévia da Promoção</h4>
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="text-muted-foreground mb-1">Cargo</p>
                        <p className="line-through opacity-60 break-words [overflow-wrap:anywhere]">{selecionado.cargoNome}</p>
                        <p className="text-green-600 font-medium break-words [overflow-wrap:anywhere]">{cargoEscolhido.nome}</p>
                      </div>
                      <div className="sm:text-right min-w-0">
                        <p className="text-muted-foreground mb-1">Salário</p>
                        <p className="line-through opacity-60">{formatarMoeda(selecionado.salario)}</p>
                        <p className="text-green-600 font-medium break-all">{formatarMoeda(novoSalario)}</p>
                      </div>
                    </div>
                    {mudaDepartamento && (
                      <div className="text-sm">
                        <p className="text-muted-foreground mb-1">Departamento</p>
                        <p className="break-words [overflow-wrap:anywhere]">
                          <span className="line-through opacity-60">{selecionado.departamentoNome}</span>
                          {' → '}
                          <span className="text-green-600 font-medium">{departamentoEscolhido!.nome}</span>
                        </p>
                      </div>
                    )}
                    <div className="pt-3 border-t border-border">
                      <div className="flex flex-wrap justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">
                          {diferencaSalario >= 0 ? 'Aumento Salarial:' : 'Redução Salarial (não permitida):'}
                        </span>
                        <span className={`font-medium ${diferencaSalario >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {diferencaSalario >= 0 ? '+' : '-'} {formatarMoeda(Math.abs(diferencaSalario))} ({percentualVariacao}%)
                        </span>
                      </div>
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
                disabled={envio.salvando || carregandoOpcoes}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {envio.salvandoId === selecionado.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Aplicar Promoção</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <TrendingUp className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-center">Selecione um colaborador ao lado para aplicar uma promoção</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
