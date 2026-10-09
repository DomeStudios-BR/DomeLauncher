import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

async function listarArquivos(pasta: string): Promise<string[]> {
    const entradas = await readdir(pasta, { withFileTypes: true });
    const grupos = await Promise.all(entradas.map(async entrada => {
        const caminho = join(pasta, entrada.name);
        return entrada.isDirectory() ? listarArquivos(caminho) : [caminho];
    }));
    return grupos.flat();
}

/** Gera a atualização somente quando os instaladores das duas plataformas possuem assinaturas. */
export async function gerarManifestoAtualizacao(
    pasta: string,
    repositorio: string,
    tag: string,
    notas: string,
    dataPublicacao = new Date().toISOString(),
) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repositorio) || !/^v\d+\.\d+\.\d+$/.test(tag)) {
        throw new Error("Repositório ou tag inválidos para o manifesto de atualização.");
    }

    const arquivos = await listarArquivos(pasta);
    const plataformas: Record<string, { signature: string; url: string }> = {};
    const formatos = [
        { extensao: ".exe", plataformas: ["windows-x86_64", "windows-x86_64-nsis"] },
        { extensao: ".AppImage", plataformas: ["linux-x86_64", "linux-x86_64-appimage"] },
        { extensao: ".deb", plataformas: ["linux-x86_64-deb"] },
    ];

    for (const formato of formatos) {
        const candidatos = arquivos.filter(arquivo => arquivo.endsWith(formato.extensao));
        if (candidatos.length !== 1) {
            throw new Error(`Esperado um instalador ${formato.extensao}, encontrados ${candidatos.length}.`);
        }
        const instalador = candidatos[0];
        const assinatura = (await readFile(`${instalador}.sig`, "utf8")).trim();
        if (!assinatura) {
            throw new Error(`Assinatura vazia para ${basename(instalador)}.`);
        }
        const nomeArquivo = encodeURIComponent(basename(instalador));
        for (const plataforma of formato.plataformas) {
            plataformas[plataforma] = {
                signature: assinatura,
                url: `https://github.com/${repositorio}/releases/download/${tag}/${nomeArquivo}`,
            };
        }
    }

    return { version: tag.slice(1), notes: notas, pub_date: dataPublicacao, platforms: plataformas };
}

if (import.meta.main) {
    const pasta = process.argv[2];
    const repositorio = process.env.GITHUB_REPOSITORY;
    const tag = process.env.VERSAO_TAG;
    if (!pasta || !repositorio || !tag) {
        throw new Error("Informe a pasta, GITHUB_REPOSITORY e VERSAO_TAG para gerar o manifesto.");
    }
    const arquivos = await listarArquivos(pasta);
    const nomes = arquivos.map(arquivo => basename(arquivo).replaceAll(" ", "."));
    if (new Set(nomes).size !== nomes.length) {
        throw new Error("Os artefatos possuem nomes repetidos após a normalização.");
    }
    for (const arquivo of arquivos) {
        const nome = basename(arquivo).replaceAll(" ", ".");
        if (nome !== basename(arquivo)) {
            await rename(arquivo, join(dirname(arquivo), nome));
        }
    }
    const manifesto = await gerarManifestoAtualizacao(pasta, repositorio, tag, process.env.CORPO_RELEASE ?? "");
    await writeFile(join(pasta, "latest.json"), `${JSON.stringify(manifesto, null, 4)}\n`);
}
