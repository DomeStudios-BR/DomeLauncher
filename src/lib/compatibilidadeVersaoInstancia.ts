interface CompatibilidadeVersao {
    game_versions?: string[];
    loaders?: string[];
}

/** Confere os metadados recebidos além dos filtros enviados à plataforma. */
export function versaoCompativelComInstancia(
    versao: CompatibilidadeVersao,
    minecraft: string,
    loader: string,
    considerarLoader: boolean,
): boolean {
    const versoesMinecraft = versao.game_versions ?? [];
    if (versoesMinecraft.length > 0 && !versoesMinecraft.some((tag) => tag.trim() === minecraft.trim())) {
        return false;
    }
    if (!considerarLoader) return true;
    const loaders = versao.loaders ?? [];
    return loaders.length === 0 || loaders.some((tag) => tag.trim().toLowerCase() === loader.trim().toLowerCase());
}
