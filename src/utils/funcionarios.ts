import type { FuncionarioDto } from '../types/api';

/** "Maria da Silva" → "MS". */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 1).toUpperCase();
  return (partes[0].slice(0, 1) + partes[partes.length - 1].slice(0, 1)).toUpperCase();
}

// Minúsculas e sem acentos, pra "joao" achar "João".
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Filtra por nome, e-mail, departamento ou cargo. Busca vazia devolve a lista inteira. */
export function filtrarFuncionarios(lista: FuncionarioDto[], busca: string): FuncionarioDto[] {
  const termo = normalizar(busca.trim());
  if (!termo) return lista;
  return lista.filter((f) =>
    [f.nome, f.email, f.departamentoNome, f.cargoNome].some((campo) => normalizar(campo ?? '').includes(termo))
  );
}

export function ordenarPorNome(lista: FuncionarioDto[]): FuncionarioDto[] {
  return [...lista].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** "1 colaborador" / "3 colaboradores". */
export function contarColaboradores(quantidade: number): string {
  return `${quantidade} colaborador${quantidade === 1 ? '' : 'es'}`;
}
