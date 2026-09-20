import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Mail, Loader2, ShieldCheck } from "../iconesPixelados";
import { autenticarComMicrosoft } from '../lib/autenticacaoMicrosoft';

interface ContaMinecraft {
  uuid: string;
  name: string;
  access_token: string;
  expires_at?: number;
}

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginConcluido?: (conta: ContaMinecraft) => void;
}

export function LoginModal({ isOpen, onClose, onLoginConcluido }: LoginModalProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async () => {
    setStatus('loading');
    setErrorMsg('');

    try {
      const conta = await autenticarComMicrosoft();
      setStatus('success');
      onLoginConcluido?.(conta);
      setTimeout(() => {
        onClose();
        setStatus('idle');
      }, 1500);
    } catch (err: unknown) {
      console.error("Login failed:", err);
      setStatus('error');
      setErrorMsg(String(err) || "Falha desconhecida no login.");
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop desfoque */}
        <motion.div
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           exit={{ opacity: 0 }}
           onClick={onClose}
           className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-md bg-[#121214] border border-white/10 rounded-2xl p-8 shadow-2xl overflow-hidden"
        >
          {/* Botão Fechar */}
          <button
            onClick={onClose}
            className="absolute top-6 right-6 text-white/20 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>

          {/* Conteúdo Centralizado */}
          <div className="flex flex-col items-center text-center gap-6">

            {/* Ícone Status */}
            <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10">
                {status === 'loading' ? (
                    <Loader2 size={32} className="text-emerald-400 animate-spin" />
                ) : status === 'success' ? (
                    <Check size={32} className="text-emerald-400" />
                ) : (
                    <Mail size={32} className="text-emerald-400" />
                )}
            </div>

            {/* Títulos e Descrições */}
            <div>
                <h2 className="text-2xl font-bold mb-2 text-white">
                    {status === 'loading' ? 'Autenticando...' :
                     status === 'success' ? 'Login Realizado!' :
                     'Entrar com Microsoft'}
                </h2>
                <p className="text-white/40 text-sm max-w-[90%] mx-auto leading-relaxed">
                    {status === 'loading' ? 'Complete o login na janela que se abriu.' :
                     status === 'success' ? 'Preparando o launcher...' :
                     'Use sua conta Microsoft oficial para acessar os servidores e suas skins.'}
                </p>
            </div>

            {/* Botão de Ação Principal */}
            <div className="w-full space-y-4 pt-2">
                {status === 'idle' || status === 'error' ? (
                    <>
                        <button
                            onClick={handleLogin}
                            className="w-full bg-white text-[#0a0a0b] font-black py-4 rounded-xl flex items-center justify-center gap-3 hover:bg-emerald-400 transition-all active:scale-95 border border-white/10 shadow-lg shadow-white/5"
                        >
                            <img src="https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg" className="w-5 h-5" alt="" />
                            <span>INICIAR LOGIN</span>
                        </button>

                        {status === 'error' && (
                           <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-lg text-red-400 text-xs text-center break-words">
                              {errorMsg}
                           </div>
                        )}
                    </>
                ) : null}

                {/* Footer / Selo de Segurança */}
                <div className="flex items-center gap-2 justify-center text-[10px] text-white/20 font-bold uppercase tracking-widest pt-4">
                    <ShieldCheck size={12} />
                    <span>Autenticação Segura</span>
                </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
