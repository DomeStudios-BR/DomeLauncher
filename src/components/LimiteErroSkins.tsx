import React from "react";
import { RefreshCw } from "../iconesPixelados";

interface EstadoLimiteErroSkins {
  erro: Error | null;
}

interface PropriedadesLimiteErroSkins extends React.PropsWithChildren {
  tentativa: number;
  onTentarNovamente: () => void;
}

export class LimiteErroSkins extends React.Component<PropriedadesLimiteErroSkins, EstadoLimiteErroSkins> {
  state: EstadoLimiteErroSkins = { erro: null };

  static getDerivedStateFromError(erro: Error): Partial<EstadoLimiteErroSkins> {
    return { erro };
  }

  componentDidCatch(erro: Error, informacoes: React.ErrorInfo) {
    console.error("Falha ao renderizar a aba de skins:", erro, informacoes.componentStack);
  }

  componentDidUpdate(propriedadesAnteriores: PropriedadesLimiteErroSkins) {
    if (propriedadesAnteriores.tentativa !== this.props.tentativa && this.state.erro) {
      this.setState({ erro: null });
    }
  }

  render() {
    if (this.state.erro) {
      return (
        <div className="flex min-h-[420px] items-center justify-center px-6">
          <div className="max-w-md border border-red-400/20 bg-red-400/[0.04] p-7 text-center">
            <h2 className="text-lg font-black text-white">Não foi possível abrir suas skins</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/50">
              O WebView encontrou uma falha temporária ao carregar esta tela. Tente remontar a aba sem reiniciar o
              launcher.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                onClick={this.props.onTentarNovamente}
                className="flex items-center gap-2 bg-emerald-400 px-4 py-2 text-xs font-black text-black"
              >
                <RefreshCw size={14} />
                Tentar novamente
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="border border-white/10 px-4 py-2 text-xs font-bold text-white/65"
              >
                Recarregar interface
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
