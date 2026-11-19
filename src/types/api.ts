// Tipos espelhando exatamente os DTOs do backend (SistemaRH.Backend/SistemaRH.Api/Dtos).
// Nomes de campo em português, batendo com o JSON real devolvido pela API.

export interface UsuarioDto {
  id: number;
  nome: string;
  email: string;
  cargo: string;
  departamento: string;
  saldoBancoHorasMinutos: number;
  totalSolicitacoesAusencia: number;
  // null quando a conta não está vinculada a um cadastro de funcionário.
  funcionarioId: number | null;
  dataAdmissao: string | null;
  gerenteNome: string | null;
}

export interface AuthResponseDto {
  token: string;
  usuario: UsuarioDto;
}

export type PerfilUsuario = 'Funcionario' | 'Rh' | 'Admin';

// Já nas rotas de usuários (GET /api/usuarios) o perfil vem como número,
// igual aos outros enums do backend: 0 = Funcionario, 1 = Rh, 2 = Admin.
export enum PerfilUsuarioCodigo {
  Funcionario = 0,
  Rh = 1,
  Admin = 2,
}

/** Item de GET /api/usuarios (contas de acesso e o colaborador ligado, se houver). */
export interface UsuarioListaDto {
  id: number;
  nome: string;
  email: string;
  perfil: PerfilUsuarioCodigo;
  funcionarioId: number | null;
  funcionarioNome: string | null;
  funcionarioDesligado: boolean;
}

/** Corpo de PUT /api/usuarios/{id}/perfil (só Admin). */
export interface AlterarPerfilUsuarioDto {
  perfil: PerfilUsuarioCodigo;
  // Perfil que a tela mostrava. Se outra pessoa mudou antes, a API recusa
  // com 409 em vez de sobrescrever a mudança dela.
  perfilAtual?: PerfilUsuarioCodigo;
  // Obrigatória quando o perfil SOBE (Funcionário → RH/Admin, RH → Admin):
  // substitui a senha da conta, que o RH podia conhecer. Segue as regras de
  // senha. Ao rebaixar, é ignorada.
  senhaProvisoria?: string;
}

/** Corpo de PUT /api/auth/senha (a própria pessoa troca a senha). */
export interface AlterarMinhaSenhaDto {
  senhaAtual: string;
  novaSenha: string;
}

/**
 * Resposta de PUT /api/auth/senha. A troca derruba os tokens antigos (inclusive
 * o usado na requisição); este é o token novo para a sessão continuar.
 */
export interface AlterarMinhaSenhaRespostaDto {
  token: string;
}

// StatusFuncionario é serializado como número pelo backend (enum sem
// JsonStringEnumConverter): 0 = Ativo, 1 = Desligado.
export enum StatusFuncionario {
  Ativo = 0,
  Desligado = 1,
}

export interface FuncionarioDto {
  id: number;
  nome: string;
  cpf: string;
  email: string | null;
  telefone: string | null;
  dataNascimento: string | null;
  dataAdmissao: string;
  dataDesligamento: string | null;
  status: StatusFuncionario;
  departamentoId: number;
  departamentoNome: string;
  cargoId: number;
  cargoNome: string;
  gerenteId: number | null;
  gerenteNome: string | null;
  totalSolicitacoesAusencia: number;
  possuiAcessoApp: boolean;
  // Remuneração atual (R$), alterada pelas rotas de ajuste salarial, de vale
  // alimentação e de promoção.
  salario: number;
  valeAlimentacao: number;
  // Token de concorrência: sobe a cada alteração. O painel devolve esse
  // número nas rotas de escrita e, se outra pessoa tiver gravado antes, a API
  // responde 409.
  versao: number;
}

/** Resposta de POST /api/funcionarios/{id}/desligar. */
export interface DesligamentoResultadoDto {
  funcionario: FuncionarioDto;
  // Subordinados diretos que o backend moveu, na mesma transação, para o
  // gestor da pessoa desligada (ou deixou sem gestor).
  subordinadosRealocados: number;
  // null quando os subordinados ficaram sem gestor.
  novoGestorNome: string | null;
}

/** Corpo de POST /api/funcionarios/{id}/desligar. */
export interface DesligarFuncionarioDto {
  // YYYY-MM-DD, entre a admissão e hoje. Sem ela, o backend usa a data atual.
  dataDesligamento?: string;
  versao?: number;
}

export interface DepartamentoDto {
  id: number;
  nome: string;
  descricao: string;
}

export interface DepartamentoCreateDto {
  nome: string;
  descricao?: string;
}

export interface CargoDto {
  id: number;
  nome: string;
  salarioBase: number;
  descricao: string;
}

export interface FuncionarioCreateDto {
  nome: string;
  cpf: string;
  email?: string;
  telefone?: string;
  dataNascimento?: string;
  dataAdmissao: string;
  departamentoId: number;
  cargoId: number;
  gerenteId?: number | null;
  // Se informada (mín. 6 caracteres), já cria o login do colaborador no app
  // com o e-mail acima — que passa a ser obrigatório.
  senhaAcessoApp?: string;
  // Sem eles o backend usa o salarioBase do cargo e R$ 600 de vale.
  salario?: number;
  valeAlimentacao?: number;
}

// Igual ao Create, mas sem CPF (imutável depois de cadastrado) nem data de
// admissão (também não muda numa edição comum).
export interface FuncionarioUpdateDto {
  nome: string;
  email?: string;
  telefone?: string;
  dataNascimento?: string;
  departamentoId: number;
  cargoId: number;
  gerenteId?: number | null;
  versao?: number;
}

// Corpos das rotas de remuneração. `dataVigencia` no formato YYYY-MM-DD (da
// admissão até hoje) e `motivo` com 3 a 500 caracteres. `versao` é a do
// FuncionarioDto que estava na tela quando o ajuste foi feito.
export interface AjusteSalarioDto {
  novoSalario: number;
  dataVigencia: string;
  motivo: string;
  versao?: number;
}

export interface AjusteValeAlimentacaoDto {
  novoValor: number;
  dataVigencia: string;
  motivo: string;
  versao?: number;
}

export interface PromocaoDto {
  novoCargoId: number;
  novoDepartamentoId: number;
  novoSalario: number;
  dataVigencia: string;
  motivo: string;
  // Opcional: novo gestor direto. null (ou ausente) mantém o atual.
  novoGerenteId?: number | null;
  versao?: number;
}

/**
 * Resultado de uma promoção. Quando o departamento muda, os subordinados
 * diretos que ficam no departamento antigo passam para o gestor anterior da
 * pessoa promovida; `subordinadosRealocados` diz quantos foram.
 */
export interface PromocaoResultadoDto {
  funcionario: FuncionarioDto;
  subordinadosRealocados: number;
}

// Histórico de remuneração (enum como número): 0 = Salario,
// 1 = ValeAlimentacao, 2 = Promocao.
export enum TipoAjusteRemuneracao {
  Salario = 0,
  ValeAlimentacao = 1,
  Promocao = 2,
}

export interface AjusteRemuneracaoDto {
  id: number;
  tipo: TipoAjusteRemuneracao;
  valorAnterior: number;
  valorNovo: number;
  // Só vêm preenchidos nas promoções.
  cargoAnteriorNome?: string | null;
  cargoNovoNome?: string | null;
  departamentoAnteriorNome?: string | null;
  departamentoNovoNome?: string | null;
  // Data de calendário ("2026-11-17T00:00:00") — não é um instante.
  dataVigencia: string;
  motivo: string;
  responsavelNome?: string | null;
  // Instante em UTC (termina com "Z").
  criadoEm: string;
}

// TipoLancamentoBancoHoras também é serializado como número: 0 = Credito, 1 = Debito.
export enum TipoLancamentoBancoHoras {
  Credito = 0,
  Debito = 1,
}

export interface LancamentoBancoHorasDto {
  id: number;
  dataRegistro: string;
  tipo: TipoLancamentoBancoHoras;
  quantidadeMinutos: number;
  descricao: string;
  criadoEm: string;
}

export interface ExtratoBancoHorasDto {
  saldoMinutos: number;
  lancamentos: LancamentoBancoHorasDto[];
}

// Justificativas de ausência enviadas pelo app (enums também como número).
export enum StatusAusencia {
  Enviada = 0,
  EmAnalise = 1,
  Aprovada = 2,
  Recusada = 3,
}

export enum TipoAusencia {
  AtestadoMedico = 0,
  FaltaJustificada = 1,
  EsquecimentoDePonto = 2,
  Outro = 3,
}

/** Justificativa do lado do colaborador (GET /api/ausencias). */
export interface AusenciaDto {
  id: number;
  tipo: TipoAusencia;
  // Data de calendário ("2026-11-13T00:00:00") — não é um instante.
  data: string;
  diaInteiro: boolean;
  descricao: string;
  status: StatusAusencia;
  // Instante em UTC (termina com "Z").
  criadoEm: string;
  // Token de concorrência, devolvido no PUT de status.
  versao: number;
}

export interface AusenciaRhDto extends AusenciaDto {
  usuarioId: number;
  usuarioNome: string;
  usuarioEmail: string;
  funcionarioId: number | null;
}

/** Corpo de PUT /api/rh/ausencias/{id}/status. */
export interface AtualizarStatusAusenciaDto {
  status: StatusAusencia;
  versao?: number;
}

// Mensagens que o colaborador manda ao RH pelo app ("Falar com o RH").
// Enum como número: 0 = Aberta, 1 = Respondida.
export enum StatusMensagemRh {
  Aberta = 0,
  Respondida = 1,
}

export interface MensagemRhDto {
  id: number;
  usuarioId: number;
  usuarioNome: string;
  // 3 a 100 caracteres.
  assunto: string;
  // 3 a 2000 caracteres.
  mensagem: string;
  status: StatusMensagemRh;
  resposta: string | null;
  // Instante em UTC (termina com "Z").
  respondidaEm: string | null;
  responsavelNome: string | null;
  criadoEm: string;
  versao: number;
}

/** Corpo de POST /api/mensagens-rh. */
export interface MensagemRhCreateDto {
  assunto: string;
  mensagem: string;
}

/** Corpo de PUT /api/rh/mensagens/{id}/resposta. */
export interface ResponderMensagemRhDto {
  // 3 a 2000 caracteres.
  resposta: string;
  versao: number;
}

/** Folha de pagamento (holerite) de um mês, como em /api/folha-pagamento. */
export interface FolhaPagamentoDto {
  id: number;
  funcionarioId: number;
  // "AAAA-MM".
  competencia: string;
  salario: number;
  bonus: number;
  descontos: number;
  salarioLiquido: number;
  dataPagamento: string | null;
}

// Candidatos de processos seletivos (RecrutamentoController).
export enum StatusRecrutamento {
  EmProcesso = 0,
  Entrevista = 1,
  Aprovado = 2,
  Rejeitado = 3,
}

export interface RecrutamentoDto {
  id: number;
  nomeCandidato: string;
  email: string | null;
  telefone: string | null;
  vaga: string;
  dataCandidatura: string;
  status: StatusRecrutamento;
  observacoes: string;
}

export interface ApiErrorBody {
  mensagem: string;
}
