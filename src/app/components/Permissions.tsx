import { useEffect, useMemo, useRef, useState } from 'react';
import { Shield, Search, Save, User, Loader2, RefreshCw, Lock, Eye, EyeOff, Wand2, Copy, KeyRound } from 'lucide-react';
import { api, ApiError, ehConflito } from '../../services/api';
import { useAuth } from '../context/AuthContext';
import { useAvisos, useFocoAposEnvio } from '../context/AvisosContext';
import { PerfilUsuarioCodigo, type AlterarPerfilUsuarioDto, type UsuarioListaDto } from '../../types/api';
import { iniciais, normalizarBusca } from '../../utils/funcionarios';
import { SENHA_APP_MAXIMO, validarSenhaProvisoria } from '../../utils/validacao';

const MENSAGEM_RESPOSTA_INESPERADA = 'O servidor devolveu uma resposta inesperada. Tente novamente.';

// Os três perfis que existem no backend (o antigo "TI" nunca existiu).
const PERFIS: { codigo: PerfilUsuarioCodigo; nome: string; descricao: string; classes: string }[] = [
  {
    codigo: PerfilUsuarioCodigo.Funcionario,
    nome: 'Funcionário',
    descricao: 'Usa o app e, no painel, vê só o Dashboard e Meus Dados.',
    classes: 'bg-gray-100 text-gray-700',
  },
  {
    codigo: PerfilUsuarioCodigo.Rh,
    nome: 'RH',
    descricao: 'Acessa as telas de RH: colaboradores, remuneração, organograma e solicitações.',
    classes: 'bg-green-100 text-green-700',
  },
  {
    codigo: PerfilUsuarioCodigo.Admin,
    nome: 'Admin',
    descricao: 'Tudo o que o RH faz e, além disso, altera o perfil de acesso das contas.',
    classes: 'bg-blue-100 text-blue-700',
  },
];

const NOMES_PERFIL_API = ['Funcionario', 'Rh', 'Admin'];

// Os códigos seguem a hierarquia (Funcionário 0 < RH 1 < Admin 2). Subir de
// perfil exige senha provisória: a senha antiga pode ter sido escolhida pelo
// RH, que então entraria na conta promovida. Perfil desconhecido conta como
// subida (a API decide de novo).
function ehPromocao(de: PerfilUsuarioCodigo | null, para: PerfilUsuarioCodigo): boolean {
  return de === null || para > de;
}

// Sem letras e números parecidos (0/O, 1/l/I), para ditar ou copiar à mão.
const ALFABETO_SENHA = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Senha provisória aleatória (12 caracteres, com letra e número), dentro das regras de senha. */
function gerarSenhaProvisoria(): string {
  const valores = new Uint32Array(12);
  for (;;) {
    crypto.getRandomValues(valores);
    const senha = Array.from(valores, (v) => ALFABETO_SENHA[v % ALFABETO_SENHA.length]).join('');
    if (/\d/.test(senha) && /[a-z]/i.test(senha)) return senha;
  }
}

/**
 * A senha provisória aparece uma vez só, logo depois da promoção, para o
 * Admin passar à pessoa. Não fica guardada em lugar nenhum além desta tela.
 */
function SenhaEntregue({ nome, senha, onFechar }: { nome: string; senha: string; onFechar: () => void }) {
  const [copiada, setCopiada] = useState(false);
  const campoRef = useRef<HTMLInputElement>(null);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(senha);
      setCopiada(true);
    } catch {
      // Sem acesso à área de transferência (permissão, http): deixa a senha
      // selecionada para Ctrl+C.
      campoRef.current?.select();
    }
  }

  return (
    <div
      id="senha-entregue"
      tabIndex={-1}
      role="status"
      className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-sm space-y-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
    >
      <p className="m-0 font-medium text-amber-900 [overflow-wrap:anywhere]">Senha provisória de {nome}</p>
      <div className="flex gap-2">
        <input
          ref={campoRef}
          readOnly
          value={senha}
          aria-label={`Senha provisória de ${nome}`}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 px-3 py-2 bg-white border border-amber-300 rounded-lg font-mono"
        />
        <button
          type="button"
          onClick={copiar}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-400 bg-white text-amber-900 hover:bg-amber-100 shrink-0"
        >
          <Copy size={14} aria-hidden="true" />
          {copiada ? 'Copiada' : 'Copiar'}
        </button>
      </div>
      <p className="m-0 text-amber-900">
        Passe esta senha para a pessoa por um canal seguro. Ela não será mostrada de novo. A pessoa entra com ela e
        deve trocá-la em Meus Dados &gt; Senha; qualquer senha que alguém conhecia antes já não vale mais.
      </p>
      <button type="button" onClick={onFechar} className="text-amber-900 underline">
        Já anotei, esconder a senha
      </button>
    </div>
  );
}

// O contrato manda o perfil como número; um nome ("Rh") também é aceito,
// para a tela não mostrar um perfil vazio se o backend mudar a serialização.
function codigoPerfil(valor: unknown): PerfilUsuarioCodigo | null {
  if (valor === 0 || valor === 1 || valor === 2) return valor;
  const indice = typeof valor === 'string' ? NOMES_PERFIL_API.indexOf(valor) : -1;
  return indice >= 0 ? (indice as PerfilUsuarioCodigo) : null;
}

function dadosPerfil(valor: unknown) {
  const codigo = codigoPerfil(valor);
  return PERFIS.find((p) => p.codigo === codigo) ?? null;
}

function SeloPerfil({ perfil }: { perfil: unknown }) {
  const dados = dadosPerfil(perfil);
  return (
    <span className={`text-xs px-2 py-1 rounded whitespace-nowrap ${dados?.classes ?? 'bg-gray-100 text-gray-700'}`}>
      {dados?.nome ?? 'Perfil desconhecido'}
    </span>
  );
}

export function Permissions() {
  const { token, perfil: meuPerfil, usuario: eu } = useAuth();
  // Só Admin altera perfis (a API exige isso em PUT /usuarios/{id}/perfil);
  // RH vê a lista, sem poder mudar nada.
  const podeAlterar = meuPerfil === 'Admin';

  const [usuarios, setUsuarios] = useState<UsuarioListaDto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [perfilEscolhido, setPerfilEscolhido] = useState<PerfilUsuarioCodigo | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  // Senha provisória da promoção (só quando o perfil sobe).
  const [senhaProvisoria, setSenhaProvisoria] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [senhaEntregue, setSenhaEntregue] = useState<{ nome: string; senha: string } | null>(null);

  const { avisarGlobal } = useAvisos();
  const focarAposEnvio = useFocoAposEnvio();
  const montadaRef = useRef(true);
  // Carga em andamento: cancelada quando outra começa ou quando a tela sai.
  const cargaRef = useRef<AbortController | null>(null);
  // Trava síncrona do Salvar (o estado só vale no próximo render).
  const salvandoRef = useRef(false);

  useEffect(() => {
    montadaRef.current = true;
    return () => {
      montadaRef.current = false;
      cargaRef.current?.abort();
    };
  }, []);

  /** Busca a lista de contas e a devolve (null se falhou ou foi cancelada). */
  async function carregar(): Promise<UsuarioListaDto[] | null> {
    if (!token || !montadaRef.current) return null;
    cargaRef.current?.abort();
    const controle = new AbortController();
    cargaRef.current = controle;
    setCarregando(true);
    setErro(null);
    try {
      const lista = await api.listarUsuarios(token, controle.signal);
      if (!Array.isArray(lista)) throw new ApiError(0, MENSAGEM_RESPOSTA_INESPERADA);
      setUsuarios(lista);
      return lista;
    } catch (e) {
      if (controle.signal.aborted) return null;
      setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar as contas de acesso.');
      return null;
    } finally {
      if (!controle.signal.aborted) setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const filtrados = useMemo(() => {
    const termo = normalizarBusca(busca);
    const ordenados = [...usuarios].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (!termo) return ordenados;
    return ordenados.filter((u) =>
      [u.nome, u.email, u.funcionarioNome, dadosPerfil(u.perfil)?.nome].some((campo) =>
        normalizarBusca(campo ?? '').includes(termo)
      )
    );
  }, [usuarios, busca]);

  const selecionado = usuarios.find((u) => u.id === selecionadoId) ?? null;
  const perfilAtual = selecionado ? codigoPerfil(selecionado.perfil) : null;
  const ehAPropriaConta = selecionado !== null && eu !== null && selecionado.id === eu.id;
  const bloqueado = !podeAlterar || ehAPropriaConta || salvando;

  const pedeSenha = perfilEscolhido !== null && perfilEscolhido !== perfilAtual && ehPromocao(perfilAtual, perfilEscolhido);

  function selecionar(u: UsuarioListaDto) {
    setSelecionadoId(u.id);
    setPerfilEscolhido(codigoPerfil(u.perfil));
    setErroSalvar(null);
    setSucesso(null);
    setSenhaProvisoria('');
    setMostrarSenha(false);
    setErroSenha(null);
    setSenhaEntregue(null);
  }

  async function salvar() {
    if (!token || !selecionado || perfilEscolhido === null || perfilEscolhido === perfilAtual || bloqueado) return;
    if (salvandoRef.current) return;
    const alvo = selecionado;
    const novo = perfilEscolhido;
    const para = dadosPerfil(novo)?.nome ?? '';
    const senha = senhaProvisoria;

    // A senha provisória é conferida antes de qualquer pergunta, com as
    // mesmas regras da API.
    if (pedeSenha) {
      const erro = validarSenhaProvisoria(senha);
      if (erro) {
        setErroSenha(erro);
        document.getElementById('senha-provisoria')?.focus();
        return;
      }
    }

    salvandoRef.current = true;
    setSalvando(true);
    setErroSalvar(null);
    setErroSenha(null);
    setSucesso(null);
    setSenhaEntregue(null);
    // Os controles ficam desabilitados durante o envio e o foco cai no BODY;
    // no fim ele vai para o que a pessoa precisa ver (erro, campo da senha,
    // sucesso ou a senha provisória entregue), já com tudo reabilitado.
    let focarDepois: string | null = null;
    try {
      // A confirmação usa o perfil de agora, e não o da tela: outro Admin
      // pode ter mudado depois que a lista foi carregada.
      const lista = await carregar();
      if (!lista) {
        if (montadaRef.current) setErroSalvar('Não foi possível conferir o perfil atual dessa conta. Tente novamente.');
        focarDepois = 'erro-salvar-perfil';
        return;
      }
      const atual = lista.find((u) => u.id === alvo.id);
      if (!atual) {
        setErroSalvar('Essa conta não existe mais.');
        focarDepois = 'erro-salvar-perfil';
        return;
      }
      const perfilReal = codigoPerfil(atual.perfil);
      if (perfilReal === novo) {
        setPerfilEscolhido(perfilReal);
        setSucesso(`${atual.nome} já está com o perfil ${para}.`);
        focarDepois = 'sucesso-perfil';
        return;
      }
      const de = dadosPerfil(perfilReal)?.nome ?? 'desconhecido';
      const promocao = ehPromocao(perfilReal, novo);
      // O perfil real pode ser outro (outra pessoa mudou): se agora é uma
      // promoção e a senha não foi pedida na tela, pede antes de enviar.
      if (promocao && validarSenhaProvisoria(senha)) {
        setErroSenha(validarSenhaProvisoria(senha));
        setErroSalvar(`O perfil atual de ${atual.nome} é ${de}. Para subir para ${para}, defina uma senha provisória.`);
        focarDepois = 'senha-provisoria';
        return;
      }
      const confirmou = window.confirm(
        promocao
          ? `Promover ${atual.nome} de ${de} para ${para}? A senha atual dessa conta deixa de valer: a pessoa entra com a senha provisória que você definiu e deve trocá-la depois. As sessões abertas dessa pessoa serão encerradas.`
          : `Alterar o perfil de ${atual.nome} de ${de} para ${para}? As sessões abertas dessa pessoa serão encerradas e ela precisará entrar de novo.`
      );
      if (!confirmou) {
        focarDepois = 'botao-salvar-perfil';
        return;
      }

      // `perfilAtual` é o perfil que a confirmação mostrou: se outro Admin
      // mudar antes deste envio chegar, a API responde 409 em vez de
      // sobrescrever a mudança dele.
      // Rebaixar não leva senha (a API ignora e não mexe na senha).
      const corpo: AlterarPerfilUsuarioDto = {
        perfil: novo,
        ...(perfilReal !== null ? { perfilAtual: perfilReal } : {}),
        ...(promocao ? { senhaProvisoria: senha } : {}),
      };
      const atualizado = await api.alterarPerfilUsuario(token, alvo.id, corpo);
      const texto = promocao
        ? `Perfil de ${atual.nome} alterado para ${para}. A senha antiga deixou de valer; passe a senha provisória abaixo para a pessoa.`
        : `Perfil de ${atual.nome} alterado para ${para}. A pessoa precisa entrar de novo para ver a mudança.`;
      // Saiu da tela no meio: o resultado aparece como aviso global (a senha
      // provisória não vai para o aviso; quem a definiu já a conhece).
      if (!montadaRef.current) {
        avisarGlobal(texto.replace(' abaixo', ' que você definiu'), 'sucesso');
        return;
      }
      setSenhaProvisoria('');
      setMostrarSenha(false);
      if (promocao) setSenhaEntregue({ nome: atual.nome, senha });
      if (atualizado && typeof atualizado === 'object' && atualizado.id === alvo.id) {
        setUsuarios((prev) => prev.map((u) => (u.id === atualizado.id ? atualizado : u)));
        setPerfilEscolhido(codigoPerfil(atualizado.perfil));
      } else {
        await carregar();
      }
      setSucesso(texto);
      focarDepois = promocao ? 'senha-entregue' : 'sucesso-perfil';
    } catch (e) {
      const mensagem = e instanceof ApiError ? e.message : 'Não foi possível alterar o perfil.';
      if (!montadaRef.current) {
        avisarGlobal(`Perfil de ${alvo.nome}: ${mensagem}`, 'erro');
        return;
      }
      // Recusa da senha provisória (regras de senha) aponta o campo dela.
      if (e instanceof ApiError && e.status === 400 && /senha/i.test(mensagem)) {
        setErroSenha(mensagem);
        focarDepois = 'senha-provisoria';
        return;
      }
      setErroSalvar(ehConflito(e) ? `${mensagem} A lista foi atualizada.` : mensagem);
      focarDepois = 'erro-salvar-perfil';
      // Alterado por outra pessoa (409), sem permissão agora (403) ou a conta
      // sumiu (404): mostra a lista como ela está.
      if (ehConflito(e) || (e instanceof ApiError && (e.status === 403 || e.status === 404))) {
        const lista = await carregar();
        const atual = lista?.find((u) => u.id === alvo.id);
        if (atual) setPerfilEscolhido(codigoPerfil(atual.perfil));
      }
    } finally {
      salvandoRef.current = false;
      setSalvando(false);
      if (focarDepois && montadaRef.current) focarAposEnvio(focarDepois);
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto animate-fade-in">
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-primary/10 rounded-lg shrink-0" aria-hidden="true">
              <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>
            <h1 className="text-2xl sm:text-3xl">Permissões</h1>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground">
            Perfil de acesso de cada conta: Funcionário, RH ou Admin
          </p>
        </div>
        <button
          type="button"
          onClick={carregar}
          disabled={carregando}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60 w-full sm:w-auto shrink-0"
        >
          <RefreshCw size={16} className={carregando ? 'animate-spin' : ''} aria-hidden="true" />
          Atualizar
        </button>
      </div>

      {!podeAlterar && (
        <div className="mb-5 flex gap-2 items-start px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <Lock size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>Somente administradores podem alterar perfis. Com o perfil RH você só consulta a lista.</span>
        </div>
      )}

      {erro && (
        <div
          role="alert"
          className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm"
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{erro}</span>
          <button
            type="button"
            onClick={carregar}
            className="px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-600 hover:bg-red-50 transition-colors shrink-0"
          >
            Tentar novamente
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Lista de contas */}
        <div className="hr-card p-4 sm:p-6 min-w-0">
          <h2 className="text-xl mb-4">Contas de acesso</h2>

          <div className="relative mb-6">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, e-mail ou perfil..."
              aria-label="Buscar conta por nome, e-mail ou perfil"
              maxLength={200}
              className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-2 max-h-[400px] sm:max-h-[600px] overflow-y-auto">
            {carregando && usuarios.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground" role="status">
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                Carregando contas…
              </div>
            ) : filtrados.length === 0 ? (
              !erro && (
                <div className="text-center py-8 text-muted-foreground">
                  <User className="w-12 h-12 mx-auto mb-2 opacity-50" aria-hidden="true" />
                  <p>{busca.trim() ? 'Nenhuma conta encontrada para essa busca.' : 'Nenhuma conta cadastrada.'}</p>
                </div>
              )
            ) : (
              filtrados.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => selecionar(u)}
                  aria-pressed={selecionadoId === u.id}
                  className={`w-full p-3 sm:p-4 rounded-lg border transition-all text-left ${
                    selecionadoId === u.id ? 'border-primary bg-primary/5' : 'border-border bg-accent/30 hover:bg-accent/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium mb-1 [overflow-wrap:anywhere]">{u.nome}</h3>
                      <p className="text-sm text-muted-foreground mb-2 break-all">{u.email}</p>
                      <div className="flex gap-2 flex-wrap">
                        {u.funcionarioId === null ? (
                          <span className="text-xs px-2 py-1 bg-accent rounded-full">Sem cadastro de colaborador</span>
                        ) : (
                          <span className="text-xs px-2 py-1 bg-accent rounded-full max-w-full [overflow-wrap:anywhere]">
                            Colaborador: {u.funcionarioNome ?? `#${u.funcionarioId}`}
                          </span>
                        )}
                        {u.funcionarioDesligado && (
                          <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full">Desligado</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <SeloPerfil perfil={u.perfil} />
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Painel do perfil */}
        <div className="hr-card p-4 sm:p-6 min-w-0">
          <h2 className="text-xl mb-4">Perfil de acesso</h2>

          {selecionado ? (
            <div className="space-y-6">
              <div className="p-4 bg-accent/30 rounded-lg border border-border">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 bg-primary rounded-full flex items-center justify-center text-primary-foreground shrink-0"
                    aria-hidden="true"
                  >
                    {iniciais(selecionado.nome)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium [overflow-wrap:anywhere]">{selecionado.nome}</h3>
                    <p className="text-sm text-muted-foreground break-all">{selecionado.email}</p>
                  </div>
                  <SeloPerfil perfil={selecionado.perfil} />
                </div>
              </div>

              <fieldset disabled={bloqueado} className="space-y-3 border-0 p-0 m-0 min-w-0">
                <legend className="font-medium mb-3">Escolha o perfil</legend>
                {PERFIS.map((p) => {
                  const idOpcao = `perfil-${selecionado.id}-${p.codigo}`;
                  const marcado = perfilEscolhido === p.codigo;
                  return (
                    <label
                      key={p.codigo}
                      htmlFor={idOpcao}
                      className={`flex items-start gap-3 p-4 rounded-lg border transition-colors ${
                        marcado ? 'border-primary bg-primary/5' : 'border-border bg-accent/20'
                      } ${bloqueado ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-accent/40'}`}
                    >
                      <input
                        id={idOpcao}
                        type="radio"
                        name={`perfil-${selecionado.id}`}
                        value={p.codigo}
                        checked={marcado}
                        onChange={() => setPerfilEscolhido(p.codigo)}
                        className="mt-1 w-4 h-4 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">
                          {p.nome}
                          {p.codigo === perfilAtual && <span className="ml-2 text-xs text-muted-foreground">(atual)</span>}
                        </span>
                        <span className="block text-sm text-muted-foreground">{p.descricao}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              {pedeSenha && podeAlterar && !ehAPropriaConta && (
                <div className="space-y-2 p-4 rounded-lg border border-border bg-accent/20">
                  <label htmlFor="senha-provisoria" className="flex items-center gap-2 font-medium">
                    <KeyRound size={16} aria-hidden="true" />
                    Senha provisória (obrigatória)
                  </label>
                  <p id="ajuda-senha-provisoria" className="m-0 text-sm text-muted-foreground">
                    Ao subir de perfil, a senha atual da conta deixa de valer (ela pode ter sido definida pelo RH). A
                    pessoa entra com esta senha provisória e deve trocá-la em Meus Dados &gt; Senha.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1 min-w-0">
                      <input
                        id="senha-provisoria"
                        type={mostrarSenha ? 'text' : 'password'}
                        value={senhaProvisoria}
                        onChange={(e) => {
                          setSenhaProvisoria(e.target.value);
                          setErroSenha(null);
                        }}
                        autoComplete="new-password"
                        maxLength={SENHA_APP_MAXIMO * 2}
                        disabled={salvando}
                        aria-invalid={erroSenha ? true : undefined}
                        aria-describedby={erroSenha ? 'ajuda-senha-provisoria erro-senha-provisoria' : 'ajuda-senha-provisoria'}
                        className="w-full pl-3 pr-10 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={() => setMostrarSenha((v) => !v)}
                        aria-label={mostrarSenha ? 'Ocultar senha provisória' : 'Mostrar senha provisória'}
                        aria-pressed={mostrarSenha}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700"
                      >
                        {mostrarSenha ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={salvando}
                      onClick={() => {
                        setSenhaProvisoria(gerarSenhaProvisoria());
                        setMostrarSenha(true);
                        setErroSenha(null);
                      }}
                      className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-primary/40 text-primary hover:bg-primary/5 transition-colors disabled:opacity-60 shrink-0"
                    >
                      <Wand2 size={16} aria-hidden="true" />
                      Gerar senha
                    </button>
                  </div>
                  {erroSenha && (
                    <p id="erro-senha-provisoria" role="alert" className="m-0 text-sm text-red-600 [overflow-wrap:anywhere]">
                      {erroSenha}
                    </p>
                  )}
                </div>
              )}

              {ehAPropriaConta && (
                <p className="m-0 text-sm text-muted-foreground">Você não pode alterar o perfil da sua própria conta.</p>
              )}
              {erroSalvar && (
                <p
                  id="erro-salvar-perfil"
                  tabIndex={-1}
                  role="alert"
                  className="m-0 text-sm text-red-600 [overflow-wrap:anywhere] focus:outline-none"
                >
                  {erroSalvar}
                </p>
              )}
              {sucesso && (
                <p
                  id="sucesso-perfil"
                  tabIndex={-1}
                  role="status"
                  className="m-0 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm [overflow-wrap:anywhere] focus:outline-none focus:ring-2 focus:ring-green-400"
                >
                  {sucesso}
                </p>
              )}
              {senhaEntregue && (
                <SenhaEntregue nome={senhaEntregue.nome} senha={senhaEntregue.senha} onFechar={() => setSenhaEntregue(null)} />
              )}

              {podeAlterar && !ehAPropriaConta && (
                <button
                  id="botao-salvar-perfil"
                  type="button"
                  onClick={salvar}
                  disabled={bloqueado || perfilEscolhido === null || perfilEscolhido === perfilAtual}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  {salvando ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>Salvar perfil</span>
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Shield className="w-16 h-16 mb-4 opacity-50" aria-hidden="true" />
              <p className="text-center">Selecione uma conta ao lado para ver o perfil de acesso</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
