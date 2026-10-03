import type { PerfilSocial } from '../components/social/tiposSocial';

type PerfilAvatar = Pick<PerfilSocial, 'contaMinecraftPrincipalUuid' | 'contasMinecraftVinculadas'>;

export function normalizarUuidAvatar(uuid?: string | null): string | null {
    const valor = uuid?.trim().toLowerCase().replace(/-/g, '');
    return valor || null;
}

/** Use a conta ativa apenas ao mostrar o próprio perfil; visitantes usam as contas do perfil consultado. */
export function escolherUuidAvatar(perfil?: PerfilAvatar | null, uuidAtivo?: string | null): string | null {
    const ativo = normalizarUuidAvatar(uuidAtivo);
    if (ativo) return ativo;
    if (!perfil) return null;
    const vinculadas = perfil.contasMinecraftVinculadas ?? [];
    return normalizarUuidAvatar(perfil.contaMinecraftPrincipalUuid)
        ?? vinculadas.map((conta) => normalizarUuidAvatar(conta.uuid)).find(Boolean)
        ?? null;
}

/** Use 256 px no perfil ampliado e 64 px nos avatares compactos. */
export function obterUrlCabecaMinecraft(uuid?: string | null, tamanho: 64 | 256 = 64): string | null {
    const normalizado = normalizarUuidAvatar(uuid);
    return normalizado ? `https://mc-heads.net/head/${normalizado}/${tamanho}` : null;
}
