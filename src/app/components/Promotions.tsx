import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Save, Briefcase, DollarSign, Calendar, Loader2, RefreshCw } from 'lucide-react';
import { api, ApiError } from '../../services/api';
import { useAuth } from '../context/AuthContext';
import { useFuncionarios } from '../hooks/useFuncionarios';
import { StatusFuncionario, type CargoDto, type DepartamentoDto, type FuncionarioDto } from '../../types/api';
import { ListaColaboradores } from './ListaColaboradores';
import { formatarMoeda, lerValor } from '../../utils/moeda';
import { formatarDataCalendario, hojeEmBrasilia } from '../../utils/datas';
import { iniciais } from '../../utils/funcionarios';

const TAMANHO_MINIMO_MOTIVO = 3;

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
  const [novoSalarioTexto, setNovoSalarioTexto] = useState('');
  const [dataVigencia, setDataVigencia] = useState(hojeEmBrasilia);
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  // Cargos e departamentos pros selects (também buscados a cada abertura da tela).
  useEffect(() => {
    if (!token) return;
    let cancelado = false;
    setCarregandoOpcoes(true);
    setErroOpcoes(null);

    Promise.all([api.listarCargos(token), api.listarDepartamentos(token)])
      .then(([cgs, deps]) => {
        if (cancelado) return;
        setCargos([...cgs].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
        setDepartamentos([...deps].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
      })
      .catch((e) => {
        if (cancelado) return;
        setErroOpcoes(e instanceof ApiError ? e.message : 'Não foi possível carregar cargos e departamentos.');
      })
      .finally(() => {
        if (!cancelado) setCarregandoOpcoes(false);
      });

    return () => {
      cancelado = true;
    };
  }, [token, versaoOpcoes]);

  const ativos = useMemo(() => funcionarios.filter((f) => f.status === StatusFuncionario.Ativo), [funcionarios]);
  const selecionado = ativos.find((f) => f.id === selecionadoId) ?? null;

  const cargoEscolhido = cargos.find((c) => String(c.id) === novoCargoId) ?? null;
  const departamentoEscolhido = departamentos.find((d) => String(d.id) === novoDepartamentoId) ?? null;
  const novoSalario = lerValor(novoSalarioTexto);
  const diferencaSalario = selecionado && novoSalario !== null ? novoSalario - selecionado.salario : 0;
  // Sem sinal: o "+"/"-" já vai na frente do valor.
  const percentualVariacao = (
    selecionado && selecionado.salario > 0 ? Math.abs(diferencaSalario / selecionado.salario) * 100 : 0
  ).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function handleSelecionar(funcionario: FuncionarioDto) {
    setSelecionadoId(funcionario.id);
    setNovoCargoId('');
    setNovoDepartamentoId(String(funcionario.departamentoId));
    setNovoSalarioTexto('');
    setDataVigencia(hojeEmBrasilia());
    setMotivo('');
    setErroSalvar(null);
    setSucesso(null);
  }

  // Ao escolher o cargo, sugere o salário base dele (o campo continua editável).
  function handleCargoChange(valor: string) {
    setNovoCargoId(valor);
    const cargo = cargos.find((c) => String(c.id) === valor);
    if (cargo) setNovoSalarioTexto(String(cargo.salarioBase));
  }

  async function handleSalvar() {
    if (!token || !selecionado) return;
    setErroSalvar(null);
    setSucesso(null);

    if (!cargoEscolhido || !departamentoEscolhido) {
      setErroSalvar('Selecione o novo cargo e o departamento.');
      return;
    }
    if (cargoEscolhido.id === selecionado.cargoId && departamentoEscolhido.id === selecionado.departamentoId) {
      setErroSalvar(
        'Escolha um cargo ou departamento diferente do atual. Para mudar só o salário, use o Ajuste Salarial.'
      );
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
      setErroSalvar(`Descreva a justificativa da promoção (mínimo de ${TAMANHO_MINIMO_MOTIVO} caracteres).`);
      return;
    }

    setSalvando(true);
    try {
      const atualizado = await api.promoverFuncionario(token, selecionado.id, {
        novoCargoId: cargoEscolhido.id,
        novoDepartamentoId: departamentoEscolhido.id,
        novoSalario,
        dataVigencia,
        motivo: motivoLimpo,
      });
      substituir(atualizado);
      setSucesso(
        `Promoção de ${atualizado.nome} registrada: ${cargoEscolhido.nome} em ${departamentoEscolhido.nome}, com salário de ${formatarMoeda(novoSalario)} a partir de ${formatarDataCalendario(dataVigencia)}.`
      );
      setNovoCargoId('');
      setNovoDepartamentoId(String(atualizado.departamentoId));
      setNovoSalarioTexto('');
      setMotivo('');
    } catch (e) {
      setErroSalvar(e instanceof ApiError ? e.message : 'Não foi possível aplicar a promoção.');
    } finally {
      setSalvando(false);
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
              <h3 className="font-medium mb-1 break-words">{funcionario.nome}</h3>
              <p className="text-sm text-muted-foreground mb-2 break-all">{funcionario.email ?? 'Sem e-mail'}</p>
              <div className="flex flex-wrap gap-2 mb-2">
                <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">{funcionario.cargoNome}</span>
                <span className="text-xs px-2 py-1 bg-accent rounded-full">{funcionario.departamentoNome}</span>
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
        <div className="hr-card p-4 sm:p-6">
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
                    <h4 className="font-medium break-words">{selecionado.nome}</h4>
                    <p className="text-sm text-muted-foreground break-all">{selecionado.email ?? 'Sem e-mail'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-border">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Cargo</p>
                    <p className="text-sm font-medium break-words">{selecionado.cargoNome}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Departamento</p>
                    <p className="text-sm font-medium break-words">{selecionado.departamentoNome}</p>
                  </div>
                  <div className="sm:col-span-2">
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
                    className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary appearance-none disabled:opacity-60"
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
                    Salário base do cargo: {formatarMoeda(cargoEscolhido.salarioBase)}
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
                  onChange={(e) => setNovoDepartamentoId(e.target.value)}
                  disabled={carregandoOpcoes}
                  className="w-full px-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary appearance-none disabled:opacity-60"
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

              {/* Novo Salário */}
              <div>
                <label htmlFor="novoSalario" className="block text-sm font-medium mb-2">
                  Novo Salário (R$)
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    id="novoSalario"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={novoSalarioTexto}
                    onChange={(e) => setNovoSalarioTexto(e.target.value)}
                    placeholder="Ex: 15000.00"
                    className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
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
                    onChange={(e) => setDataVigencia(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Justificativa */}
              <div>
                <label htmlFor="justificativaPromocao" className="block text-sm font-medium mb-2">
                  Justificativa da Promoção
                </label>
                <textarea
                  id="justificativaPromocao"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Descreva os motivos e conquistas que justificam a promoção..."
                  rows={3}
                  className="w-full px-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>

              {/* Prévia da Promoção */}
              {cargoEscolhido && novoSalario !== null && novoSalario > 0 && (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <h4 className="font-medium mb-3">Prévia da Promoção</h4>
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground mb-1">Cargo</p>
                        <p className="line-through opacity-60 break-words">{selecionado.cargoNome}</p>
                        <p className="text-green-600 font-medium break-words">{cargoEscolhido.nome}</p>
                      </div>
                      <div className="sm:text-right">
                        <p className="text-muted-foreground mb-1">Salário</p>
                        <p className="line-through opacity-60">{formatarMoeda(selecionado.salario)}</p>
                        <p className="text-green-600 font-medium">{formatarMoeda(novoSalario)}</p>
                      </div>
                    </div>
                    {departamentoEscolhido && departamentoEscolhido.id !== selecionado.departamentoId && (
                      <div className="text-sm">
                        <p className="text-muted-foreground mb-1">Departamento</p>
                        <p className="break-words">
                          <span className="line-through opacity-60">{selecionado.departamentoNome}</span>
                          {' → '}
                          <span className="text-green-600 font-medium">{departamentoEscolhido.nome}</span>
                        </p>
                      </div>
                    )}
                    <div className="pt-3 border-t border-border">
                      <div className="flex flex-wrap justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">
                          {diferencaSalario >= 0 ? 'Aumento Salarial:' : 'Redução Salarial:'}
                        </span>
                        <span className={`font-medium ${diferencaSalario >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {diferencaSalario >= 0 ? '+' : '-'} {formatarMoeda(Math.abs(diferencaSalario))} ({percentualVariacao}%)
                        </span>
                      </div>
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
                disabled={salvando || carregandoOpcoes}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
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
