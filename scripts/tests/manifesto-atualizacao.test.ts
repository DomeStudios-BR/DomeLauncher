import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gerarManifestoAtualizacao } from "../gerar-manifesto-atualizacao";

const pastas: string[] = [];

afterEach(async () => {
    await Promise.all(pastas.splice(0).map(pasta => rm(pasta, { recursive: true, force: true })));
});

async function prepararArtefatos() {
    const pasta = await mkdtemp(join(tmpdir(), "dome-manifesto-"));
    pastas.push(pasta);
    for (const extensao of ["exe", "deb", "AppImage"]) {
        const destino = join(pasta, extensao);
        await mkdir(destino);
        const caminho = join(destino, `Dome.Launcher_0.4.1.${extensao}`);
        await writeFile(caminho, "instalador");
        await writeFile(`${caminho}.sig`, `assinatura-${extensao}\n`);
    }
    return pasta;
}

test("preserva notas e aponta cada plataforma para seu instalador assinado", async () => {
    const pasta = await prepararArtefatos();
    const notas = "Versão nova\n\nCorreções e melhorias.";
    const manifesto = await gerarManifestoAtualizacao(pasta, "DomeStudios-BR/DomeLauncher", "v0.4.1", notas);
    expect(manifesto.version).toBe("0.4.1");
    expect(manifesto.notes).toBe(notas);
    expect(Object.keys(manifesto.platforms)).toHaveLength(5);
    expect(manifesto.platforms["windows-x86_64"].signature).toBe("assinatura-exe");
    expect(manifesto.platforms["windows-x86_64-nsis"]).toEqual(manifesto.platforms["windows-x86_64"]);
    expect(manifesto.platforms["linux-x86_64"].url).toEndWith("Dome.Launcher_0.4.1.AppImage");
    expect(manifesto.platforms["linux-x86_64-deb"].url).toEndWith("Dome.Launcher_0.4.1.deb");
});

test("impede publicação quando uma plataforma está incompleta", async () => {
    const pasta = await prepararArtefatos();
    await rm(join(pasta, "AppImage", "Dome.Launcher_0.4.1.AppImage"));
    await expect(gerarManifestoAtualizacao(pasta, "DomeStudios-BR/DomeLauncher", "v0.4.1", ""))
        .rejects.toThrow("Esperado um instalador .AppImage");
});

test("impede publicação de instalador sem assinatura", async () => {
    const pasta = await prepararArtefatos();
    await rm(join(pasta, "exe", "Dome.Launcher_0.4.1.exe.sig"));
    await expect(gerarManifestoAtualizacao(pasta, "DomeStudios-BR/DomeLauncher", "v0.4.1", ""))
        .rejects.toThrow();
});

test("rejeita assinaturas vazias e instaladores duplicados", async () => {
    const pasta = await prepararArtefatos();
    const assinatura = join(pasta, "exe", "Dome.Launcher_0.4.1.exe.sig");
    await writeFile(assinatura, "\n");
    await expect(gerarManifestoAtualizacao(pasta, "DomeStudios-BR/DomeLauncher", "v0.4.1", ""))
        .rejects.toThrow("Assinatura vazia");
    await writeFile(assinatura, "assinatura");
    await writeFile(join(pasta, "outro.exe"), "instalador");
    await expect(gerarManifestoAtualizacao(pasta, "DomeStudios-BR/DomeLauncher", "v0.4.1", ""))
        .rejects.toThrow("encontrados 2");
});

test("o comando normaliza os nomes enviados ao GitHub e grava o manifesto completo", async () => {
    const pasta = await prepararArtefatos();
    for (const extensao of ["exe", "deb", "AppImage"]) {
        for (const sufixo of ["", ".sig"]) {
            const original = join(pasta, extensao, `Dome.Launcher_0.4.1.${extensao}${sufixo}`);
            const destino = join(pasta, extensao, `Dome Launcher_0.4.1.${extensao}${sufixo}`);
            await rename(original, destino);
        }
    }
    const script = fileURLToPath(new URL("../gerar-manifesto-atualizacao.ts", import.meta.url));
    const resultado = Bun.spawnSync([process.execPath, script, pasta], {
        env: {
            ...process.env,
            GITHUB_REPOSITORY: "DomeStudios-BR/DomeLauncher",
            VERSAO_TAG: "v0.4.1",
            CORPO_RELEASE: "Novidades\nSegunda linha",
        },
    });
    expect(resultado.exitCode).toBe(0);
    const manifesto = JSON.parse(await readFile(join(pasta, "latest.json"), "utf8"));
    expect(manifesto.notes).toBe("Novidades\nSegunda linha");
    expect(manifesto.platforms["windows-x86_64"].url).toEndWith("Dome.Launcher_0.4.1.exe");
    expect(await readFile(join(pasta, "exe", "Dome.Launcher_0.4.1.exe"), "utf8")).toBe("instalador");
});
