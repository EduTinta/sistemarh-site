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
}

// Corpos das rotas de remuneração. `dataVigencia` no formato YYYY-MM-DD e
// `motivo` com pelo menos 3 caracteres.
export interface AjusteSalarioDto {
  novoSalario: number;
  dataVigencia: string;
  motivo: string;
}

export interface AjusteValeAlimentacaoDto {
  novoValor: number;
  dataVigencia: string;
  motivo: string;
}

export interface PromocaoDto {
  novoCargoId: number;
  novoDepartamentoId: number;
  novoSalario: number;
  dataVigencia: string;
  motivo: string;
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

export interface AusenciaRhDto {
  id: number;
  tipo: TipoAusencia;
  // Data de calendário ("2026-11-13T00:00:00") — não é um instante.
  data: string;
  diaInteiro: boolean;
  descricao: string;
  status: StatusAusencia;
  // Instante em UTC (termina com "Z").
  criadoEm: string;
  usuarioId: number;
  usuarioNome: string;
  usuarioEmail: string;
  funcionarioId: number | null;
}

export enum TipoRegistroPonto {
  Entrada = 0,
  SaidaAlmoco = 1,
  VoltaAlmoco = 2,
  Saida = 3,
}

export interface RegistroPontoRhDto {
  id: number;
  tipo: TipoRegistroPonto;
  // Instante em UTC (termina com "Z").
  registradoEm: string;
  usuarioId: number;
  usuarioNome: string;
  usuarioEmail: string;
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
