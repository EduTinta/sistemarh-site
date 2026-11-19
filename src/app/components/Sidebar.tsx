import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  Network,
  User,
  Search,
  UserPlus,
  Shield,
  Users,
  DollarSign,
  Utensils,
  TrendingUp,
  X,
  LogOut,
  ClipboardCheck,
} from 'lucide-react';
import '../styles/hr-system.css';
import { useAuth } from '../context/AuthContext';
import { useAvisos } from '../context/AvisosContext';
import { hrefDaTela, type ViewType } from '../context/NavegacaoContext';
// Usa Array.from (caractere de verdade): com slice(0, 1) um nome que começa
// com emoji virava meio emoji ("�") no avatar.
import { iniciais } from '../../utils/funcionarios';

interface SidebarProps {
  activeView: ViewType;
  /** Avisado quando um item do menu é escolhido (fecha o menu do celular). */
  onNavigate: () => void;
  isOpen: boolean;
  onClose: () => void;
}

const ID_SUBMENU_COLABORADORES = 'submenu-colaboradores';

function rotuloSubmenu(texto: string) {
  return <span style={{ fontSize: '14px', whiteSpace: 'nowrap' }}>{texto}</span>;
}

// Cada item é um link para o endereço da tela (#/...): o navegador cuida do
// histórico, e dá para abrir a tela em outra aba.
function ItemMenu({
  view,
  ativo,
  onNavigate,
  icone,
  children,
}: {
  view: ViewType;
  ativo: boolean;
  onNavigate: () => void;
  icone: ReactNode;
  children: ReactNode;
}) {
  return (
    <a
      href={hrefDaTela(view)}
      onClick={onNavigate}
      aria-current={ativo ? 'page' : undefined}
      className={`botao-menu ${ativo ? 'ativo' : ''}`}
    >
      {icone}
      {children}
    </a>
  );
}

export function Sidebar({ activeView, onNavigate, isOpen, onClose }: SidebarProps) {
  const [menuAberto, setMenuAberto] = useState(true);
  const { usuario, logout, isRhOuAdmin } = useAuth();
  const { confirmarSaida } = useAvisos();
  const botaoFecharRef = useRef<HTMLButtonElement>(null);

  // O onClose muda a cada render do App; a ref evita reinstalar o listener
  // (e roubar o foco de volta para o X) a cada render com o menu aberto.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Menu do celular: ao abrir, o foco entra nele; Esc fecha.
  useEffect(() => {
    if (!isOpen) return;
    botaoFecharRef.current?.focus();
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [isOpen]);

  const item = (view: ViewType, icone: ReactNode, rotulo: ReactNode, ativo = activeView === view) => (
    <ItemMenu view={view} ativo={ativo} onNavigate={onNavigate} icone={icone}>
      {rotulo}
    </ItemMenu>
  );

  return (
    <>
      {/* Backdrop mobile */}
      {isOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} aria-hidden="true" />}

      {/* Fechado no celular, o menu fica fora da tela e também invisível: assim
          os itens escondidos saem da ordem do Tab. A visibilidade só muda no
          fim da animação de fechar (transition de visibility), e na hora ao abrir. */}
      <aside
        id="menu-lateral"
        aria-label="Menu principal"
        className={`sidebar fixed lg:static inset-y-0 left-0 z-50 transform duration-300 ease-in-out ${
          isOpen
            ? 'translate-x-0 visible sidebar-aberta transition-transform'
            : '-translate-x-full invisible lg:visible lg:translate-x-0 transition-[translate,transform,visibility]'
        }`}
      >
        <div className="flex items-start justify-between gap-2 mb-6">
          <div className="flex items-center gap-2 lg:gap-3 min-w-0">
            <img src="/logo-humanconnect-icone.png" alt="" className="w-8 h-8 lg:w-11 lg:h-11 rounded-xl shrink-0" />
            <div className="min-w-0">
              {/* No celular o X divide a linha com o título: fonte e logo
                  menores para não ficar um por cima do outro. */}
              <p className="m-0 text-lg lg:text-[20px] font-semibold leading-tight truncate">HumanConnect</p>
              <p style={{ margin: '3px 0 0 0', fontSize: '12px', opacity: 0.7 }}>Gestão de Pessoas</p>
            </div>
          </div>
          <button
            ref={botaoFecharRef}
            type="button"
            onClick={onClose}
            className="lg:hidden shrink-0 p-1.5 -mt-1 -mr-1 rounded hover:bg-gray-700 transition-colors"
            aria-label="Fechar menu"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto -mx-1 px-1" aria-label="Telas do painel">
          {item('dashboard', <LayoutDashboard size={20} aria-hidden="true" />, <span>Dashboard</span>)}

          {isRhOuAdmin && item('organogram', <Network size={20} aria-hidden="true" />, <span>Organograma</span>)}

          {item('profile', <User size={20} aria-hidden="true" />, <span>Meus Dados</span>)}

          {isRhOuAdmin && (
            <>
              <div style={{ marginTop: '15px' }}>
                <button
                  type="button"
                  onClick={() => setMenuAberto(!menuAberto)}
                  className="botao-menu"
                  aria-expanded={menuAberto}
                  aria-controls={ID_SUBMENU_COLABORADORES}
                >
                  <Users size={20} aria-hidden="true" />
                  <span style={{ flex: 1, textAlign: 'left' }}>Colaboradores</span>
                  <span aria-hidden="true">{menuAberto ? '▼' : '►'}</span>
                </button>

                {menuAberto && (
                  <div id={ID_SUBMENU_COLABORADORES} style={{ marginLeft: '8px' }}>
                    {item('buscarColaborador', <Search size={18} aria-hidden="true" />, rotuloSubmenu('Buscar Colaborador'))}
                    {item('newEmployee', <UserPlus size={18} aria-hidden="true" />, rotuloSubmenu('Novo Colaborador'))}
                    {item('salaryAdjustment', <DollarSign size={18} aria-hidden="true" />, rotuloSubmenu('Ajuste Salarial'))}
                    {item('mealVoucherAdjustment', <Utensils size={18} aria-hidden="true" />, rotuloSubmenu('Vale Alimentação'))}
                    {item('promotions', <TrendingUp size={18} aria-hidden="true" />, rotuloSubmenu('Promoções'))}
                  </div>
                )}
              </div>

              {/* Justificativas e Mensagens ao RH ficam na mesma tela, em abas. */}
              {item(
                'solicitacoes',
                <ClipboardCheck size={20} aria-hidden="true" />,
                <span>Solicitações</span>,
                activeView === 'solicitacoes' || activeView === 'mensagensRh'
              )}

              {item('permissions', <Shield size={20} aria-hidden="true" />, <span>Permissões</span>)}
            </>
          )}
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid #374151' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              aria-hidden="true"
              style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              {usuario ? iniciais(usuario.nome) : '?'}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {usuario?.nome ?? 'Usuário'}
              </p>
              <p style={{ margin: 0, fontSize: '12px', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {usuario?.email ?? ''}
              </p>
            </div>
            <button
              type="button"
              // Sair com um formulário pela metade também pede confirmação.
              onClick={() => {
                if (confirmarSaida()) logout();
              }}
              aria-label="Sair"
              title="Sair"
              style={{ background: 'transparent', border: 'none', color: 'white', opacity: 0.7, cursor: 'pointer', padding: '6px', flexShrink: 0 }}
            >
              <LogOut size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
