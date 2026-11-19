import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../services/api';
import { useAuth } from '../context/AuthContext';
import type { FuncionarioDto } from '../../types/api';

/**
 * Carrega a lista de funcionários (ativos e desligados) quando a tela monta.
 * Não existe cache entre telas de propósito: cada uma busca de novo ao abrir,
 * então um colaborador recém-cadastrado já aparece na próxima tela visitada.
 */
export function useFuncionarios() {
  const { token } = useAuth();
  const [funcionarios, setFuncionarios] = useState<FuncionarioDto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (!token) return;

    // Evita que uma resposta antiga sobrescreva a de um recarregamento mais
    // novo e cancela o GET se a pessoa sair da tela antes da resposta.
    let cancelado = false;
    const controle = new AbortController();
    setCarregando(true);
    setErro(null);

    api
      .listarFuncionarios(token, controle.signal)
      .then((lista) => {
        if (cancelado) return;
        // Uma resposta fora do formato (página de proxy, objeto) não pode
        // derrubar a tela inteira com "x.filter is not a function".
        if (!Array.isArray(lista)) {
          setErro('O servidor devolveu uma resposta inesperada. Tente novamente.');
          return;
        }
        setFuncionarios(lista);
      })
      .catch((e) => {
        if (cancelado) return;
        setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar os colaboradores.');
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
      controle.abort();
    };
  }, [token, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  /** Troca um item da lista pela versão devolvida pela API (ex. depois de um ajuste). */
  const substituir = useCallback((atualizado: FuncionarioDto) => {
    setFuncionarios((prev) => prev.map((f) => (f.id === atualizado.id ? atualizado : f)));
  }, []);

  return { funcionarios, carregando, erro, recarregar, substituir };
}
