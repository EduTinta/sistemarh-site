import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UserPlus, Save, X, Loader2, Plus, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { api, ApiError } from '../../services/api';
import { useAuth } from '../context/AuthContext';
import { useAvisos, useConfirmarSaida } from '../context/AvisosContext';
import { useMontado } from '../hooks/useMontado';
import { marcarEnvioEmAndamento } from '../hooks/envioEmAndamento';
import type { CargoDto, DepartamentoDto, FuncionarioDto } from '../../types/api';
import { StatusFuncionario } from '../../types/api';
import { cpfValido, formatarCpf } from '../../utils/cpf';
import { contarDigitosTelefone, formatarTelefone, validarTelefone } from '../../utils/telefone';
import {
  formatarMoeda,
  formatarValorEditavel,
  lerValorMonetario,
  pedeConfirmacao,
  previaMonetaria,
  validarSalario,
  validarVale,
  variacaoPercentual,
  formatarPercentual,
  VARIACAO_PEDE_CONFIRMACAO,
} from '../../utils/moeda';
import { itensComNome, salarioBaseDoCargo } from '../../utils/listas';
import { focoPodeSerMovido } from '../../utils/foco';
import {
  DATA_MINIMA_NASCIMENTO,
  EMAIL_MAXIMO,
  NOME_DEPARTAMENTO_MAXIMO,
  NOME_PESSOA_MAXIMO,
  SENHA_APP_MAXIMO,
  SENHA_APP_MINIMO,
  faixaAdmissao,
  limparTexto,
  nascimentoMaximo,
  normalizarEmail,
  validarDataAdmissao,
  validarDataNascimento,
  validarEmail,
  validarNomeDepartamento,
  validarNomePessoa,
  validarSenhaApp,
} from '../../utils/validacao';

const CRIAR_NOVO = '__criar_novo__';

// Mesmo padrão que o backend usa quando o vale não é informado.
const VALE_ALIMENTACAO_PADRAO = formatarValorEditavel(600);

const FORM_INICIAL = {
  nome: '',
  email: '',
  cpf: '',
  telefone: '',
  dataNascimento: '',
  dataAdmissao: '',
  departamentoId: '',
  cargoId: '',
  gerenteId: '',
  salario: '',
  valeAlimentacao: VALE_ALIMENTACAO_PADRAO,
  senhaAcessoApp: '',
};

type CampoFormulario = keyof typeof FORM_INICIAL;
type CampoComErro = CampoFormulario | 'novoDepartamento';

// Id do elemento de cada campo (o novo departamento tem um id próprio).
const ID_DO_CAMPO = (campo: CampoComErro) => (campo === 'novoDepartamento' ? 'novoDepartamentoNome' : campo);

// Erros de carga de cada lista, separados: a falha de uma não pode apagar as
// outras (antes, se só a lista de colaboradores falhasse, o cadastro ficava
// sem departamentos e cargos).
interface ErrosListas {
  departamentos: string | null;
  cargos: string | null;
  funcionarios: string | null;
}

const SEM_ERROS_LISTAS: ErrosListas = { departamentos: null, cargos: null, funcionarios: null };
const MENSAGEM_LISTA_INESPERADA = 'O servidor devolveu uma lista inesperada.';

function mensagemDeFalha(resultado: PromiseSettledResult<unknown>, padrao: string): string {
  if (resultado.status === 'rejected' && resultado.reason instanceof ApiError) return resultado.reason.message;
  return padrao;
}

/**
 * Campo a que uma mensagem de erro da API se refere, para o erro aparecer no
 * campo (borda e texto embaixo) e não só no aviso do topo. Vale a primeira que
 * bater, então a ordem importa (V2-04):
 * - "A data de admissão precisa estar entre … depois do nascimento" é da admissão;
 * - "Informe o salário: o cargo escolhido não tem um salário base…" é do salário;
 * - "O vale alimentação…" é do vale, mesmo citando o salário;
 * - "O nome do departamento…" é do departamento, e não do nome.
 */
const CAMPO_DA_MENSAGEM: [RegExp, CampoFormulario][] = [
  [/gestor/i, 'gerenteId'],
  [/senha/i, 'senhaAcessoApp'],
  [/\bcpf\b/i, 'cpf'],
  [/e-?mail|conta de acesso/i, 'email'],
  [/telefone/i, 'telefone'],
  [/admiss/i, 'dataAdmissao'],
  [/nascimento/i, 'dataNascimento'],
  [/vale/i, 'valeAlimentacao'],
  [/sal[aá]rio/i, 'salario'],
  [/departamento/i, 'departamentoId'],
  [/cargo/i, 'cargoId'],
  [/nome/i, 'nome'],
];

function campoDaMensagem(mensagem: string): CampoFormulario | null {
  return CAMPO_DA_MENSAGEM.find(([padrao]) => padrao.test(mensagem))?.[1] ?? null;
}

export function NewEmployee() {
  const { token } = useAuth();
  const { avisarGlobal } = useAvisos();
  const montado = useMontado();
  const [formData, setFormData] = useState(FORM_INICIAL);
  // Erro preso a um campo: borda vermelha e a mensagem logo abaixo dele.
  const [erroCampo, setErroCampo] = useState<{ campo: CampoComErro; mensagem: string } | null>(null);

  const [departamentos, setDepartamentos] = useState<DepartamentoDto[]>([]);
  const [cargos, setCargos] = useState<CargoDto[]>([]);
  const [funcionarios, setFuncionarios] = useState<FuncionarioDto[]>([]);
  const [carregandoListas, setCarregandoListas] = useState(true);
  const [errosListas, setErrosListas] = useState<ErrosListas>(SEM_ERROS_LISTAS);

  const [criandoDepartamento, setCriandoDepartamento] = useState(false);
  const [novoDepartamentoNome, setNovoDepartamentoNome] = useState('');
  const [salvandoDepartamento, setSalvandoDepartamento] = useState(false);

  const [enviando, setEnviando] = useState(false);
  // Aviso geral do topo: erros que não são de um campo (rede, servidor) e o sucesso.
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  // Travas síncronas: o `disabled` dos botões depende de um re-render, e dois
  // envios no mesmo instante passavam os dois.
  const enviandoRef = useRef(false);
  const salvandoDepartamentoRef = useRef(false);
  // Último salário preenchido a partir do cargo. Se o campo ainda tem esse
  // valor, trocar o cargo pode atualizá-lo; se a pessoa digitou outro, não.
  const salarioSugeridoRef = useRef<string | null>(null);
  // Carga das listas em andamento, cancelada ao sair da tela ou ao recarregar.
  const cargaListasRef = useRef<AbortController | null>(null);

  // O botão de cadastrar fica no fim do formulário e o aviso no topo: sem
  // isso, o erro (ou o sucesso, que limpa o formulário) aparece fora da tela
  // e parece que nada aconteceu.
  const avisoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (erro || sucesso) {
      avisoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [erro, sucesso]);
  // Aviso do topo (erro geral ou sucesso), que recebe o foco quando não há campo.
  const bannerRef = useRef<HTMLDivElement>(null);

  // Onde o foco deve ir depois de um erro ou de um envio. O foco espera o
  // campo ser reabilitado: durante o envio e enquanto as listas recarregam
  // (depois de um 400, os selects ficam desabilitados), um `focus()` era
  // ignorado e o foco terminava no BODY (V5-01).
  // `origem` é o elemento que tinha o foco quando o pedido foi feito: se a
  // pessoa já foi para outro campo, o pedido é descartado (V6-02).
  const [focoPendente, setFocoPendenteBruto] = useState<{ alvo: CampoComErro | 'aviso'; origem: Element | null } | null>(
    null
  );
  const setFocoPendente = (alvo: CampoComErro | 'aviso') =>
    setFocoPendenteBruto({ alvo, origem: document.activeElement });
  const botaoEnviarRef = useRef<HTMLButtonElement>(null);
  const [mostrarSenhaApp, setMostrarSenhaApp] = useState(false);

  const criaAcessoApp = formData.senhaAcessoApp.length > 0;
  const previaSalario = previaMonetaria(formData.salario);
  const previaVale = previaMonetaria(formData.valeAlimentacao);
  const faixaDataAdmissao = faixaAdmissao(formData.dataNascimento || null);

  // Avisos que aparecem enquanto a pessoa digita, antes de enviar.
  const telefoneAoVivo =
    contarDigitosTelefone(formData.telefone) > 11 || (/^\+/.test(formData.telefone) && formData.telefone.length > 2)
      ? validarTelefone(formData.telefone)
      : null;
  const emailAoVivo =
    formData.email.trim().length > EMAIL_MAXIMO ? `O e-mail pode ter no máximo ${EMAIL_MAXIMO} caracteres.` : null;

  // Alterações não salvas: sair da tela ou dar F5 pede confirmação. Durante o
  // envio não, porque o resultado chega pelo aviso global.
  const formularioAlterado =
    (Object.keys(FORM_INICIAL) as CampoFormulario[]).some((campo) => formData[campo] !== FORM_INICIAL[campo]) ||
    (criandoDepartamento && novoDepartamentoNome.trim() !== '');
  useConfirmarSaida(formularioAlterado && !enviando);

  const carregarListas = useCallback(async () => {
    if (!token) return;
    cargaListasRef.current?.abort();
    const controle = new AbortController();
    cargaListasRef.current = controle;
    setCarregandoListas(true);
    const erros: ErrosListas = { ...SEM_ERROS_LISTAS };
    try {
      const [resDeps, resCargos, resFuncs] = await Promise.allSettled([
        api.listarDepartamentos(token, controle.signal),
        api.listarCargos(token, controle.signal),
        api.listarFuncionarios(token, controle.signal),
      ]);
      if (controle.signal.aborted) return;

      // Itens sem nome (resposta fora do formato) são descartados; se não
      // sobrar nenhum, vira erro com "Tentar novamente".
      const deps = itensComNome<DepartamentoDto>(resDeps.status === 'fulfilled' ? resDeps.value : null);
      if (resDeps.status === 'fulfilled' && deps.valida) setDepartamentos(deps.itens);
      else erros.departamentos = mensagemDeFalha(resDeps, `Não foi possível carregar os departamentos. ${MENSAGEM_LISTA_INESPERADA}`);

      const cgs = itensComNome<CargoDto>(resCargos.status === 'fulfilled' ? resCargos.value : null);
      if (resCargos.status === 'fulfilled' && cgs.valida) setCargos(cgs.itens);
      else erros.cargos = mensagemDeFalha(resCargos, `Não foi possível carregar os cargos. ${MENSAGEM_LISTA_INESPERADA}`);

      const funcs = itensComNome<FuncionarioDto>(resFuncs.status === 'fulfilled' ? resFuncs.value : null);
      if (resFuncs.status === 'fulfilled' && funcs.valida) {
        // Só funcionários ativos podem ser escolhidos como gestor — alguém
        // desligado não deveria aparecer como chefe de ninguém.
        const ativos = funcs.itens.filter((f) => f.status === StatusFuncionario.Ativo);
        setFuncionarios(ativos);
        // Um gestor escolhido que foi desligado (ou sumiu) sai da seleção: o
        // select mostraria "Nenhum" e o id antigo iria escondido no envio.
        const idsAtivos = new Set(ativos.map((f) => String(f.id)));
        setFormData((prev) => (prev.gerenteId && !idsAtivos.has(prev.gerenteId) ? { ...prev, gerenteId: '' } : prev));
      } else {
        erros.funcionarios = mensagemDeFalha(resFuncs, `Não foi possível carregar a lista de colaboradores. ${MENSAGEM_LISTA_INESPERADA}`);
      }
    } catch {
      if (controle.signal.aborted) return;
      erros.departamentos = 'Não foi possível carregar departamentos e cargos.';
    }
    setErrosListas(erros);
    setCarregandoListas(false);
  }, [token]);

  useEffect(() => {
    carregarListas();
    return () => cargaListasRef.current?.abort();
  }, [carregarListas]);

  // Só quem está no departamento escolhido pode ser gestor direto.
  const gestoresDoDepartamento = useMemo(
    () =>
      funcionarios
        .filter((f) => String(f.departamentoId) === formData.departamentoId)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [funcionarios, formData.departamentoId]
  );

  const errosDeCarga = [errosListas.departamentos, errosListas.cargos].filter(Boolean) as string[];

  // Erro de um campo: fica nele (borda e mensagem embaixo), e a tela rola até
  // ele. Sem campo, o erro vai para o aviso do topo.
  function mostrarErro(mensagem: string, campo: CampoComErro | null = null) {
    setSucesso(null);
    if (campo) {
      setErro(null);
      setErroCampo({ campo, mensagem });
    } else {
      setErroCampo(null);
      setErro(mensagem);
    }
    setFocoPendente(campo ?? 'aviso');
  }

  // Leva o foco ao campo com erro (ou ao aviso do topo) assim que nada mais o
  // desabilita. Se o campo continuar desabilitado (ex.: gestor sem lista), o
  // foco vai para a mensagem de erro embaixo dele.
  useEffect(() => {
    if (focoPendente === null || carregandoListas || enviando) return;
    // Só move o foco se ele estiver perdido (BODY), no botão de envio ou onde
    // estava quando o erro apareceu. Se a pessoa já está digitando em outro
    // campo (as listas podem demorar a recarregar), o pedido é descartado e
    // nenhuma letra se perde.
    setFocoPendenteBruto(null);
    if (!focoPodeSerMovido(document.activeElement, document.body, [botaoEnviarRef.current, focoPendente.origem])) return;
    if (focoPendente.alvo === 'aviso') {
      bannerRef.current?.focus({ preventScroll: true });
    } else {
      const id = ID_DO_CAMPO(focoPendente.alvo);
      const campo = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
      const alvo = campo && !campo.disabled ? campo : document.getElementById(`${id}-erro`);
      alvo?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      alvo?.focus({ preventScroll: true });
    }
  }, [focoPendente, carregandoListas, enviando]);

  function limparErroDoCampo(campo: CampoComErro) {
    setErroCampo((atual) => (atual?.campo === campo ? null : atual));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    limparErroDoCampo(name as CampoFormulario);

    // Ao abrir a criação de departamento, o departamento e o gestor escolhidos
    // antes deixam de valer: um Enter ou um envio não pode gravar o colaborador
    // no departamento antigo. É uma nova ação: o sucesso anterior sai da tela.
    if (name === 'departamentoId' && value === CRIAR_NOVO) {
      setCriandoDepartamento(true);
      setSucesso(null);
      setFormData((prev) => ({ ...prev, departamentoId: '', gerenteId: '' }));
      return;
    }

    if (name === 'cpf') {
      setFormData((prev) => ({ ...prev, cpf: formatarCpf(value) }));
      return;
    }

    // A máscara tira o +55/0055 explícito e o 0 antes do DDD. Dígitos a mais
    // ficam no campo, com o erro embaixo, em vez de virarem outro número.
    if (name === 'telefone') {
      setFormData((prev) => ({ ...prev, telefone: formatarTelefone(value) }));
      return;
    }

    // O gestor direto é escolhido entre as pessoas do departamento: ao trocar
    // de departamento, o gestor escolhido antes deixa de valer.
    if (name === 'departamentoId') {
      setFormData((prev) => ({ ...prev, departamentoId: value, gerenteId: '' }));
      return;
    }

    // Ao escolher o cargo, sugere o salário base dele, sem sobrescrever um
    // salário que a pessoa já digitou (o campo continua editável). Cargo sem
    // salário base válido (resposta fora do contrato) não sugere nada.
    if (name === 'cargoId') {
      const base = salarioBaseDoCargo(cargos.find((c) => String(c.id) === value));
      const podeSugerir = !formData.salario.trim() || formData.salario === salarioSugeridoRef.current;
      if (base !== null && podeSugerir) {
        const sugestao = formatarValorEditavel(base);
        salarioSugeridoRef.current = sugestao;
        setFormData((prev) => ({ ...prev, cargoId: value, salario: sugestao }));
      } else {
        setFormData((prev) => ({ ...prev, cargoId: value }));
      }
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function fecharCriacaoDepartamento() {
    setCriandoDepartamento(false);
    setNovoDepartamentoNome('');
    limparErroDoCampo('novoDepartamento');
  }

  async function handleCriarDepartamento() {
    if (!token || salvandoDepartamentoRef.current) return;
    // Nova ação: o sucesso do cadastro anterior não fica junto do erro dela.
    setSucesso(null);
    const erroNome = validarNomeDepartamento(novoDepartamentoNome);
    if (erroNome) {
      mostrarErro(erroNome, 'novoDepartamento');
      return;
    }
    salvandoDepartamentoRef.current = true;
    setSalvandoDepartamento(true);
    setErro(null);
    try {
      const novo = await api.criarDepartamento(token, { nome: limparTexto(novoDepartamentoNome) });
      setDepartamentos((prev) =>
        [...prev.filter((d) => d.id !== novo.id), novo].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      );
      // Departamento novo ainda não tem ninguém: o gestor escolhido antes (de
      // outro departamento) não pode ficar gravado escondido.
      setFormData((prev) => ({ ...prev, departamentoId: String(novo.id), gerenteId: '' }));
      fecharCriacaoDepartamento();
      // O campo e o botão "Criar" saem da tela: o foco vai para o select, que
      // agora mostra o departamento novo.
      setFocoPendente('departamentoId');
    } catch (e) {
      mostrarErro(e instanceof ApiError ? e.message : 'Não foi possível criar o departamento.', 'novoDepartamento');
    } finally {
      salvandoDepartamentoRef.current = false;
      setSalvandoDepartamento(false);
    }
  }

  // Enter no nome do novo departamento cria o departamento; nunca envia o
  // formulário do colaborador. Esc desiste da criação.
  function handleNovoDepartamentoKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!salvandoDepartamento && novoDepartamentoNome.trim()) handleCriarDepartamento();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      fecharCriacaoDepartamento();
    }
  }

  // Mesmas regras da API, na ordem dos campos na tela. Devolve o primeiro
  // problema encontrado (e o campo dele) ou null.
  function primeiroErroDoFormulario(): { mensagem: string; campo: CampoComErro } | null {
    const erroNome = validarNomePessoa(formData.nome);
    if (erroNome) return { mensagem: erroNome, campo: 'nome' };

    const email = normalizarEmail(formData.email);
    if (criaAcessoApp && !email) {
      return {
        mensagem: 'Para criar o acesso ao app, informe o e-mail corporativo — é com ele que o colaborador entra no app.',
        campo: 'email',
      };
    }
    const erroEmail = email ? validarEmail(formData.email) : null;
    if (erroEmail) return { mensagem: erroEmail, campo: 'email' };

    if (!cpfValido(formData.cpf)) {
      const completo = formData.cpf.replace(/\D/g, '').length === 11;
      return { mensagem: completo ? 'CPF inválido. Confira os dígitos.' : 'Informe os 11 dígitos do CPF.', campo: 'cpf' };
    }

    const erroNascimento = validarDataNascimento(formData.dataNascimento);
    if (erroNascimento) return { mensagem: erroNascimento, campo: 'dataNascimento' };

    const erroTelefone = formData.telefone.trim() ? validarTelefone(formData.telefone) : null;
    if (erroTelefone) return { mensagem: erroTelefone, campo: 'telefone' };

    const erroAdmissao = validarDataAdmissao(formData.dataAdmissao, formData.dataNascimento || null);
    if (erroAdmissao) return { mensagem: erroAdmissao, campo: 'dataAdmissao' };

    if (!formData.cargoId) return { mensagem: 'Selecione o cargo.', campo: 'cargoId' };

    // Em branco, o backend usa o salário base do cargo e o vale padrão.
    const erroSalario = formData.salario.trim() ? validarSalario(lerValorMonetario(formData.salario)) : null;
    if (erroSalario) return { mensagem: erroSalario, campo: 'salario' };
    const erroVale = formData.valeAlimentacao.trim() ? validarVale(lerValorMonetario(formData.valeAlimentacao)) : null;
    if (erroVale) return { mensagem: erroVale, campo: 'valeAlimentacao' };

    if (criandoDepartamento) {
      return {
        mensagem: 'Termine de criar o novo departamento (botão Criar) ou cancele antes de cadastrar.',
        campo: 'novoDepartamento',
      };
    }
    if (!formData.departamentoId) return { mensagem: 'Selecione o departamento.', campo: 'departamentoId' };

    const erroSenha = criaAcessoApp ? validarSenhaApp(formData.senhaAcessoApp) : null;
    if (erroSenha) return { mensagem: erroSenha, campo: 'senhaAcessoApp' };
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || enviandoRef.current) return;
    setErro(null);
    setSucesso(null);
    setErroCampo(null);

    const problema = primeiroErroDoFormulario();
    if (problema) {
      mostrarErro(problema.mensagem, problema.campo);
      return;
    }

    const salario = formData.salario.trim() ? lerValorMonetario(formData.salario) : null;
    const valeAlimentacao = formData.valeAlimentacao.trim() ? lerValorMonetario(formData.valeAlimentacao) : null;

    // Salário muito longe do base do cargo costuma ser erro de digitação.
    const cargo = cargos.find((c) => String(c.id) === formData.cargoId);
    const baseDoCargo = salarioBaseDoCargo(cargo);
    if (salario !== null && cargo && baseDoCargo !== null && pedeConfirmacao(baseDoCargo, salario)) {
      const variacao = variacaoPercentual(baseDoCargo, salario);
      const confirmado = window.confirm(
        `O salário informado (${formatarMoeda(salario)}) está ${formatarPercentual(Math.abs(variacao))} ` +
          `${salario > baseDoCargo ? 'acima' : 'abaixo'} do salário base de ${cargo.nome} (${formatarMoeda(baseDoCargo)}).\n\n` +
          `É uma diferença maior que ${VARIACAO_PEDE_CONFIRMACAO}%. Confirma que o valor está certo?`
      );
      if (!confirmado) return;
    }

    const email = normalizarEmail(formData.email);
    const nome = limparTexto(formData.nome);
    enviandoRef.current = true;
    setEnviando(true);
    // Até a resposta chegar, F5 ou fechar a aba pedem confirmação (o cadastro
    // pode já estar gravado no servidor).
    const liberarSaida = marcarEnvioEmAndamento();
    try {
      const criado = await api.criarFuncionario(token, {
        nome,
        cpf: formData.cpf.trim(),
        email: email || undefined,
        telefone: formData.telefone.trim() || undefined,
        dataNascimento: formData.dataNascimento || undefined,
        dataAdmissao: formData.dataAdmissao,
        departamentoId: Number(formData.departamentoId),
        cargoId: Number(formData.cargoId),
        gerenteId: formData.gerenteId ? Number(formData.gerenteId) : undefined,
        salario: salario ?? undefined,
        valeAlimentacao: valeAlimentacao ?? undefined,
        senhaAcessoApp: criaAcessoApp ? formData.senhaAcessoApp : undefined,
      });
      const mensagemApp = criaAcessoApp
        ? ` Ele(a) já pode entrar no app com o e-mail ${criado.email ?? email} e a senha definida.`
        : '';
      const mensagem = `${criado.nome} foi cadastrado(a) com sucesso em ${criado.departamentoNome} e já aparece no Organograma e nas listas de colaboradores.${mensagemApp}`;
      // Saiu da tela antes da resposta: o resultado vai para o aviso global.
      if (!montado.current) {
        avisarGlobal(mensagem, 'sucesso');
        return;
      }
      setSucesso(mensagem);
      setFocoPendente('aviso');
      setFormData(FORM_INICIAL);
      salarioSugeridoRef.current = null;
      setMostrarSenhaApp(false);
      setFuncionarios((prev) => [...prev, criado]);
    } catch (e) {
      const mensagem = e instanceof ApiError ? e.message : 'Não foi possível cadastrar o colaborador.';
      if (!montado.current) {
        avisarGlobal(`O cadastro de ${nome} não foi concluído: ${mensagem}`, 'erro');
        return;
      }
      // Erro de regra (gestor desligado, CPF já cadastrado, departamento que
      // sumiu...): relê as listas para o formulário refletir o estado atual.
      if (e instanceof ApiError && (e.status === 400 || e.status === 404 || e.status === 409)) {
        carregarListas();
      }
      mostrarErro(mensagem, e instanceof ApiError && e.status < 500 && e.status > 0 ? campoDaMensagem(mensagem) : null);
    } finally {
      liberarSaida();
      enviandoRef.current = false;
      if (montado.current) setEnviando(false);
    }
  }

  function handleReset() {
    if (enviandoRef.current) return;
    setFormData(FORM_INICIAL);
    salarioSugeridoRef.current = null;
    setMostrarSenhaApp(false);
    fecharCriacaoDepartamento();
    setErro(null);
    setSucesso(null);
    setErroCampo(null);
  }

  // O padding vai à parte para quem precisa de outro (ex. o campo de senha com o ícone).
  const classeCampo = (campo: CampoComErro, padding = 'px-4 py-2', comErro = false) =>
    `w-full ${padding} bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 ${
      erroCampo?.campo === campo || comErro ? 'border-red-400' : 'border-border'
    }`;

  // Atributos de acessibilidade do campo com erro (aponta para a mensagem embaixo).
  const ariaErro = (campo: CampoComErro, comErro = false) =>
    erroCampo?.campo === campo || comErro
      ? { 'aria-invalid': true as const, 'aria-describedby': `${ID_DO_CAMPO(campo)}-erro` }
      : {};

  // Mensagem embaixo do campo: o erro da validação/API ou o aviso ao vivo.
  // Função (e não componente) para o parágrafo não ser recriado a cada tecla.
  function mensagemDoCampo(campo: CampoComErro, aoVivo?: string | null) {
    const mensagem = erroCampo?.campo === campo ? erroCampo.mensagem : aoVivo;
    if (!mensagem) return null;
    return (
      <p id={`${ID_DO_CAMPO(campo)}-erro`} tabIndex={-1} role="alert" className="mt-1.5 text-xs text-red-600 [overflow-wrap:anywhere]">
        {mensagem}
      </p>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto animate-fade-in">
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <UserPlus className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
          </div>
          <h1 className="text-2xl sm:text-3xl">Novo Colaborador</h1>
        </div>
        <p className="text-sm sm:text-base text-muted-foreground">Preencha os dados do novo colaborador</p>
      </div>

      {/* noValidate: as mensagens nativas do navegador saíam no idioma dele e
          sem as regras da API. A validação é feita em primeiroErroDoFormulario. */}
      <form onSubmit={handleSubmit} noValidate className="hr-card p-4 sm:p-6 min-w-0">
        <div className="space-y-6">
          <div ref={avisoRef} className="space-y-6 empty:hidden scroll-mt-4">
            {erro && (
              <div ref={bannerRef} tabIndex={-1} role="alert" className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm break-words [overflow-wrap:anywhere]">
                {erro}
              </div>
            )}
            {sucesso && (
              <div ref={bannerRef} tabIndex={-1} role="status" className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm break-words [overflow-wrap:anywhere]">
                {sucesso}
              </div>
            )}
          </div>

          {!carregandoListas && errosDeCarga.length > 0 && (
            <div role="alert" className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
              <p className="m-0 [overflow-wrap:anywhere]">{[...new Set(errosDeCarga)].join(' ')}</p>
              <button
                type="button"
                onClick={carregarListas}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:underline"
              >
                <RefreshCw size={14} />
                Tentar novamente
              </button>
            </div>
          )}

          {/* Informações Pessoais */}
          <div>
            <h2 className="text-xl mb-4 pb-2 border-b border-border">Informações Pessoais</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="min-w-0">
                <label htmlFor="nome" className="block text-sm mb-2">
                  Nome Completo <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="nome"
                  name="nome"
                  value={formData.nome}
                  onChange={handleChange}
                  required
                  maxLength={NOME_PESSOA_MAXIMO * 2}
                  {...ariaErro('nome')}
                  className={classeCampo('nome')}
                  placeholder="Digite o nome completo"
                />
                {mensagemDoCampo('nome')}
              </div>

              <div className="min-w-0">
                <label htmlFor="email" className="block text-sm mb-2">
                  E-mail Corporativo {criaAcessoApp && <span className="text-red-500">*</span>}
                </label>
                {/* Sem maxLength: um e-mail colado com mais de 254 caracteres era
                    cortado em silêncio e gravado com outro domínio. Agora ele fica
                    inteiro e o erro aparece embaixo. */}
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  autoComplete="off"
                  {...ariaErro('email', !!emailAoVivo)}
                  className={classeCampo('email', undefined, !!emailAoVivo)}
                  placeholder="email@empresa.com"
                />
                {mensagemDoCampo('email', emailAoVivo)}
              </div>

              <div className="min-w-0">
                <label htmlFor="cpf" className="block text-sm mb-2">
                  CPF <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="cpf"
                  name="cpf"
                  inputMode="numeric"
                  value={formData.cpf}
                  onChange={handleChange}
                  required
                  maxLength={14}
                  {...ariaErro('cpf')}
                  className={classeCampo('cpf')}
                  placeholder="000.000.000-00"
                />
                {mensagemDoCampo('cpf')}
              </div>

              <div className="min-w-0">
                <label htmlFor="dataNascimento" className="block text-sm mb-2">
                  Data de Nascimento
                </label>
                <input
                  type="date"
                  id="dataNascimento"
                  name="dataNascimento"
                  value={formData.dataNascimento}
                  onChange={handleChange}
                  min={DATA_MINIMA_NASCIMENTO}
                  max={nascimentoMaximo()}
                  {...ariaErro('dataNascimento')}
                  className={classeCampo('dataNascimento')}
                />
                {mensagemDoCampo('dataNascimento')}
              </div>

              <div className="min-w-0">
                <label htmlFor="telefone" className="block text-sm mb-2">
                  Telefone
                </label>
                {/* Sem maxLength: um número colado com "+55 (11) ..." era cortado antes da máscara. */}
                <input
                  type="tel"
                  id="telefone"
                  name="telefone"
                  inputMode="tel"
                  autoComplete="tel-national"
                  value={formData.telefone}
                  onChange={handleChange}
                  {...ariaErro('telefone', !!telefoneAoVivo)}
                  className={classeCampo('telefone', undefined, !!telefoneAoVivo)}
                  placeholder="(00) 00000-0000"
                />
                {mensagemDoCampo('telefone', telefoneAoVivo)}
              </div>
            </div>
          </div>

          {/* Informações Profissionais */}
          <div>
            <h2 className="text-xl mb-4 pb-2 border-b border-border">Informações Profissionais</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="min-w-0">
                <label htmlFor="dataAdmissao" className="block text-sm mb-2">
                  Data de Admissão <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  id="dataAdmissao"
                  name="dataAdmissao"
                  value={formData.dataAdmissao}
                  onChange={handleChange}
                  required
                  min={faixaDataAdmissao.minimo}
                  max={faixaDataAdmissao.maximo}
                  {...ariaErro('dataAdmissao')}
                  className={classeCampo('dataAdmissao')}
                />
                {mensagemDoCampo('dataAdmissao')}
              </div>

              <div className="min-w-0">
                <label htmlFor="cargoId" className="block text-sm mb-2">
                  Cargo <span className="text-red-500">*</span>
                </label>
                <select
                  id="cargoId"
                  name="cargoId"
                  value={formData.cargoId}
                  onChange={handleChange}
                  required
                  disabled={carregandoListas}
                  {...ariaErro('cargoId')}
                  className={`${classeCampo('cargoId')} truncate`}
                >
                  <option value="">{carregandoListas ? 'Carregando…' : 'Selecione o cargo'}</option>
                  {cargos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
                {mensagemDoCampo('cargoId')}
              </div>

              <div className="min-w-0">
                <label htmlFor="salario" className="block text-sm mb-2">
                  Salário (R$)
                </label>
                {/* Texto, e não type=number: o number dependia do idioma do navegador e gravava "5.000" como R$ 5,00. */}
                <input
                  type="text"
                  id="salario"
                  name="salario"
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={20}
                  value={formData.salario}
                  onChange={handleChange}
                  aria-invalid={erroCampo?.campo === 'salario' || (previaSalario ? !previaSalario.valido : undefined)}
                  aria-describedby={erroCampo?.campo === 'salario' ? 'salario-erro' : 'salarioPrevia'}
                  className={classeCampo('salario')}
                  placeholder="Ex: 5.000,00"
                />
                {mensagemDoCampo('salario')}
                <p
                  id="salarioPrevia"
                  aria-live="polite"
                  className={`mt-1.5 text-xs ${previaSalario && !previaSalario.valido ? 'text-red-600' : 'text-muted-foreground'}`}
                >
                  {previaSalario ? `${previaSalario.texto} ` : ''}
                  Preenchido com o salário base do cargo escolhido; pode ser alterado.
                </p>
              </div>

              <div className="min-w-0">
                <label htmlFor="valeAlimentacao" className="block text-sm mb-2">
                  Vale alimentação (R$)
                </label>
                <input
                  type="text"
                  id="valeAlimentacao"
                  name="valeAlimentacao"
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={20}
                  value={formData.valeAlimentacao}
                  onChange={handleChange}
                  aria-invalid={erroCampo?.campo === 'valeAlimentacao' || (previaVale ? !previaVale.valido : undefined)}
                  aria-describedby={erroCampo?.campo === 'valeAlimentacao' ? 'valeAlimentacao-erro' : 'valePrevia'}
                  className={classeCampo('valeAlimentacao')}
                  placeholder="Ex: 600,00"
                />
                {mensagemDoCampo('valeAlimentacao')}
                <p
                  id="valePrevia"
                  aria-live="polite"
                  className={`mt-1.5 text-xs ${previaVale && !previaVale.valido ? 'text-red-600' : 'text-muted-foreground'}`}
                >
                  {previaVale ? previaVale.texto : 'Em branco, usa o padrão de R$ 600,00.'}
                </p>
              </div>

              <div className="md:col-span-2 min-w-0">
                <label htmlFor={criandoDepartamento ? 'novoDepartamentoNome' : 'departamentoId'} className="block text-sm mb-2">
                  Departamento <span className="text-red-500">*</span>
                </label>

                {!criandoDepartamento ? (
                  <select
                    id="departamentoId"
                    name="departamentoId"
                    value={formData.departamentoId}
                    onChange={handleChange}
                    required
                    disabled={carregandoListas}
                    {...ariaErro('departamentoId')}
                    className={`${classeCampo('departamentoId')} truncate`}
                  >
                    <option value="">{carregandoListas ? 'Carregando…' : 'Selecione o departamento'}</option>
                    {departamentos.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nome}
                      </option>
                    ))}
                    <option value={CRIAR_NOVO}>+ Criar novo departamento…</option>
                  </select>
                ) : (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      id="novoDepartamentoNome"
                      value={novoDepartamentoNome}
                      onChange={(e) => {
                        setNovoDepartamentoNome(e.target.value);
                        limparErroDoCampo('novoDepartamento');
                      }}
                      onKeyDown={handleNovoDepartamentoKeyDown}
                      placeholder="Nome do novo departamento"
                      maxLength={NOME_DEPARTAMENTO_MAXIMO * 2}
                      autoFocus
                      {...ariaErro('novoDepartamento')}
                      className={`${classeCampo('novoDepartamento')} flex-1 min-w-0`}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCriarDepartamento}
                        disabled={salvandoDepartamento || !novoDepartamentoNome.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60 whitespace-nowrap"
                      >
                        {salvandoDepartamento ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        <span>Criar</span>
                      </button>
                      <button
                        type="button"
                        onClick={fecharCriacaoDepartamento}
                        disabled={salvandoDepartamento}
                        className="px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/80 transition-colors whitespace-nowrap disabled:opacity-60"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                {mensagemDoCampo(criandoDepartamento ? 'novoDepartamento' : 'departamentoId')}
              </div>

              <div className="md:col-span-2 min-w-0">
                <label htmlFor="gerenteId" className="block text-sm mb-2">
                  Gestor direto
                </label>
                <select
                  id="gerenteId"
                  name="gerenteId"
                  value={formData.gerenteId}
                  onChange={handleChange}
                  disabled={carregandoListas || !formData.departamentoId || errosListas.funcionarios !== null}
                  {...ariaErro('gerenteId')}
                  className={`${classeCampo('gerenteId')} truncate`}
                >
                  <option value="">
                    {errosListas.funcionarios !== null
                      ? 'Lista de colaboradores indisponível (sem gestor)'
                      : !formData.departamentoId
                        ? 'Selecione o departamento primeiro'
                        : gestoresDoDepartamento.length === 0
                          ? 'Ninguém neste departamento ainda (topo da hierarquia)'
                          : 'Nenhum (topo da hierarquia)'}
                  </option>
                  {gestoresDoDepartamento.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome} · {f.cargoNome}
                    </option>
                  ))}
                </select>
                {mensagemDoCampo('gerenteId')}
                {errosListas.funcionarios !== null ? (
                  <div className="mt-1.5 text-xs text-red-600">
                    <span className="[overflow-wrap:anywhere]">
                      {errosListas.funcionarios} O colaborador pode ser cadastrado sem gestor e ajustado depois.
                    </span>{' '}
                    <button
                      type="button"
                      onClick={carregarListas}
                      disabled={carregandoListas}
                      className="inline-flex items-center gap-1 font-medium text-red-700 hover:underline disabled:opacity-60"
                    >
                      <RefreshCw size={12} />
                      Tentar novamente
                    </button>
                  </div>
                ) : (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Mostra só os colaboradores do departamento selecionado. Define onde esse colaborador aparece no Organograma.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Acesso ao App */}
          <div>
            <h2 className="text-xl mb-4 pb-2 border-b border-border">Acesso ao App</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="min-w-0">
                <label htmlFor="senhaAcessoApp" className="block text-sm mb-2">
                  Senha de acesso ao app (opcional)
                </label>
                <div className="relative">
                  <input
                    type={mostrarSenhaApp ? 'text' : 'password'}
                    id="senhaAcessoApp"
                    name="senhaAcessoApp"
                    value={formData.senhaAcessoApp}
                    onChange={handleChange}
                    autoComplete="new-password"
                    maxLength={SENHA_APP_MAXIMO * 2}
                    {...ariaErro('senhaAcessoApp')}
                    className={classeCampo('senhaAcessoApp', 'pl-4 pr-10 py-2')}
                    placeholder={`De ${SENHA_APP_MINIMO} a ${SENHA_APP_MAXIMO} caracteres`}
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarSenhaApp((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={mostrarSenhaApp ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {mostrarSenhaApp ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {mensagemDoCampo('senhaAcessoApp')}
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Se preenchida, o colaborador já poderá entrar no app com o e-mail corporativo e essa senha (o
                  e-mail passa a ser obrigatório). Sem espaços no começo ou no fim. Dá para criar o acesso depois,
                  pelo Organograma.
                </p>
              </div>
            </div>
          </div>

          {/* Botões de Ação */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-4 border-t border-border">
            <button
              type="submit"
              ref={botaoEnviarRef}
              disabled={enviando}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity w-full sm:w-auto disabled:opacity-60"
            >
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>Cadastrar Colaborador</span>
            </button>

            {/* Desabilitado durante o envio: limpar no meio fazia o erro chegar com o formulário vazio. */}
            <button
              type="button"
              onClick={handleReset}
              disabled={enviando}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-accent text-accent-foreground rounded-lg hover:bg-accent/80 transition-colors w-full sm:w-auto disabled:opacity-60"
            >
              <X className="w-4 h-4" />
              <span>Limpar Formulário</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
