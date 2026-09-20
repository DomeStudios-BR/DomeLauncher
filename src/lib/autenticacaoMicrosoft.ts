import { invoke } from '@tauri-apps/api/core';
import { CONFIGURACAO_SOCIAL } from './configuracaoSocial';

export const EVENTO_SESSAO_SOCIAL_ATUALIZADA = 'dome:sessao-social-atualizada';

export interface ContaMinecraftAutenticada {
  uuid: string;
  name: string;
  access_token: string;
  expires_at?: number;
}

export async function autenticarComMicrosoft(): Promise<ContaMinecraftAutenticada> {
  const conta = await invoke<ContaMinecraftAutenticada>('login_microsoft_sisu');
  const sessaoAtualBruta = await invoke<string | null>('carregar_sessao_social_local');

  if (sessaoAtualBruta) {
    const sessaoAtual = JSON.parse(sessaoAtualBruta) as {
      accessToken: string;
      perfil: Record<string, unknown>;
    };
    const resposta = await invoke<{ perfil: Record<string, unknown> }>('link_launcher_minecraft_account', {
      apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
      accessToken: sessaoAtual.accessToken,
      payload: {
        uuid: conta.uuid,
        nome: conta.name,
        minecraftAccessToken: conta.access_token,
      },
    });
    const sessaoAtualizada = { ...sessaoAtual, perfil: resposta.perfil };
    await persistirSessaoSocial(sessaoAtualizada);
    return conta;
  }

  const sessao = await invoke<Record<string, unknown>>('exchange_launcher_minecraft_session', {
    apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
    minecraftAccessToken: conta.access_token,
  });
  await persistirSessaoSocial(sessao);
  return conta;
}

async function persistirSessaoSocial(sessao: Record<string, unknown>): Promise<void> {
  await invoke('salvar_sessao_social_local', { sessao: JSON.stringify(sessao) });
  window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_SOCIAL_ATUALIZADA, { detail: sessao }));
}
