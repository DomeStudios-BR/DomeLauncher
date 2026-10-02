import type { PreviaPacoteSocial } from '../social/TransferenciasSociais';
import { SelecaoArquivosPacote } from '../social/SelecaoArquivosPacote';

export function caminhoPublicavel(caminho: string): boolean {
    return (
        ['mods', 'resourcepacks', 'shaderpacks', 'config', 'defaultconfigs', 'kubejs', 'scripts'].includes(
            caminho.split('/')[0],
        ) || ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat'].includes(caminho)
    );
}

export function SelecaoConteudoModpack({
    previa,
    selecionados,
    onAlterar,
    carregando,
}: {
    previa?: PreviaPacoteSocial;
    selecionados: Set<string>;
    onAlterar: (arquivos: Set<string>) => void;
    carregando: boolean;
}) {
    if (carregando)
        return (
            <p role="status" className="modpacks-ajuda">
                Lendo arquivos da instância...
            </p>
        );
    if (!previa) return null;
    const arquivosSelecionados = previa.arquivos.filter((arquivo) => selecionados.has(arquivo.caminho));
    // Arquivos com referência Modrinth não são embutidos no .dome — só os sem referência contam pro tamanho real
    const referenciados = arquivosSelecionados.filter((arquivo) => arquivo.referencia).length;
    const tamanhoEmbutido = arquivosSelecionados
        .filter((arquivo) => !arquivo.referencia)
        .reduce((total, arquivo) => total + arquivo.tamanhoBytes, 0);
    return (
        <div>
            <div className="modpacks-arquivos">
                <SelecaoArquivosPacote
                    arquivos={previa.arquivos}
                    selecionados={selecionados}
                    onAlterar={onAlterar}
                    podeSelecionar={caminhoPublicavel}
                />
            </div>
            <p className="modpacks-ajuda" aria-live="polite">
                {selecionados.size} arquivos selecionados ·{' '}
                {(tamanhoEmbutido / 1024 / 1024).toFixed(1)} MiB embutidos
                {referenciados > 0 && ` · ${referenciados} referenciados do Modrinth`}
            </p>
        </div>
    );
}
