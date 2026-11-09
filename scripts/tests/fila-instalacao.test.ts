import { expect, test } from "bun:test";
import { executarFilaInstalacao } from "../../src/lib/filaInstalacaoConteudo";
import type { ItemPlanoInstalacaoConteudo } from "../../src/components/instance/RevisaoInstalacaoConteudo";

const chave = (id: string) => `curseforge:project:${id}`;
const item = (id: string, selecoes = [id], selecionado = true): ItemPlanoInstalacaoConteudo => ({
    chave: chave(id), projectId: id, nome: id, nomeArquivo: `${id}.jar`,
    downloadUrl: "https://example.com/mod.jar", versao: "1", tipoVersao: "release",
    plataforma: "curseforge", tipoProjeto: "mod", requeridoPor: [], selecionado,
    selecoes: selecoes.map(chave),
});

test("falha no download não bloqueia os itens seguintes nem remove o item com problema", async () => {
    const tentados: string[] = [];
    const resultado = await executarFilaInstalacao([item("a"), item("falha"), item("b")], async (atual) => {
        tentados.push(atual.nome);
        if (atual.nome === "falha") throw new Error("Download falhou");
    });
    expect(tentados).toEqual(["a", "falha", "b"]);
    expect([...resultado.concluidos]).toEqual([chave("a"), chave("b")]);
    expect(resultado.falhas.map((falha) => falha.chave)).toEqual([chave("falha")]);
});

test("falha em dependência compartilhada mantém os requerentes pendentes e continua os independentes", async () => {
    const tentados: string[] = [];
    const resultado = await executarFilaInstalacao([
        item("biblioteca", ["a", "b"], false), item("a"), item("independente"), item("b"),
    ], async (atual) => {
        tentados.push(atual.nome);
        if (atual.nome === "biblioteca") throw new Error("Indisponível");
    });
    expect(tentados).toEqual(["biblioteca", "independente"]);
    expect([...resultado.concluidos]).toEqual([chave("independente")]);
    expect(resultado.falhas.map((falha) => falha.nome)).toEqual(["a", "b"]);
});

test("biblioteca compartilhada é baixada uma vez e falha de um mod não afeta o outro", async () => {
    const tentados: string[] = [];
    const resultado = await executarFilaInstalacao([
        item("biblioteca", ["a", "b"], false), item("a"), item("b"),
    ], async (atual) => {
        tentados.push(atual.nome);
        if (atual.nome === "a") throw new Error("Indisponível");
    });
    expect(tentados).toEqual(["biblioteca", "a", "b"]);
    expect([...resultado.concluidos]).toEqual([chave("b")]);
});
