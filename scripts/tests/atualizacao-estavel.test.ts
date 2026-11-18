import { expect, test } from "bun:test";
import { selecionarAtualizacaoEstavel } from "../../src/lib/atualizacaoEstavel";

const publicacao = (tipo: string, nome: string) => ({
    id: nome,
    version_type: tipo,
    files: [{ filename: nome, url: `https://exemplo.com/${nome}`, primary: true }],
});

test("ignora beta e alpha e sugere a publicação estável", () => {
    const estavel = publicacao("release", "nova.jar");
    expect(selecionarAtualizacaoEstavel([
        publicacao("beta", "beta.jar"), publicacao("alpha", "alpha.jar"), estavel,
    ], { fileName: "antiga.jar" })).toBe(estavel);
});

test("não sugere versões experimentais ou sem estabilidade declarada", () => {
    expect(selecionarAtualizacaoEstavel([
        publicacao("beta", "beta.jar"), publicacao("alpha", "alpha.jar"), publicacao("", "outra.jar"),
    ], { fileName: "antiga.jar" })).toBeNull();
});

test("não sugere regressão de beta instalada para release anterior", () => {
    expect(selecionarAtualizacaoEstavel([
        publicacao("beta", "atual.jar"), publicacao("release", "antiga.jar"),
    ], { fileName: "atual.jar.disabled" })).toBeNull();
});

test("localiza arquivo renomeado pelo versionId e não sugere regressão", () => {
    expect(selecionarAtualizacaoEstavel([
        publicacao("beta", "atual.jar"), publicacao("release", "antiga.jar"),
    ], { fileName: "meumod.jar", versionId: "atual.jar" })).toBeNull();
});

test("não sugere a mesma release instalada", () => {
    expect(selecionarAtualizacaoEstavel([publicacao("release", "atual.jar")], { fileName: "atual.jar" })).toBeNull();
});
