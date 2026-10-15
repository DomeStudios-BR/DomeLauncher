import { describe, expect, test } from "bun:test";
import { interpretarMotd } from "../../src/lib/motdMinecraft";

describe("MOTD Minecraft", () => {
    test("preserva cores legadas, estilos, espaços e quebra de linha", () => {
        expect(interpretarMotd("§aOlá §lMundo\n§rServidor")).toEqual([
            { texto: "Olá ", estilo: { color: "#55ff55" } },
            { texto: "Mundo\n", estilo: { color: "#55ff55", bold: true } },
            { texto: "Servidor", estilo: {} },
        ]);
    });

    test("herda estilos JSON e permite removê los nos filhos sem afetar irmãos", () => {
        expect(interpretarMotd({ text: "A", color: "gold", bold: true, extra: [
            { text: "B", color: "#123456", bold: false }, "C",
        ] })).toEqual([
            { texto: "A", estilo: { color: "#ffaa00", bold: true } },
            { texto: "B", estilo: { color: "#123456", bold: false } },
            { texto: "C", estilo: { color: "#ffaa00", bold: true } },
        ]);
    });

    test("componentes em lista herdam o estilo do primeiro elemento", () => {
        const trechos = interpretarMotd([{ text: "A", color: "red" }, { text: "B", italic: true }]);
        expect(trechos[1]).toEqual({ texto: "B", estilo: { color: "#ff5555", italic: true } });
    });

    test("aceita RGB legado e troca de cor limpa estilos legados", () => {
        expect(interpretarMotd("§lA§x§1§2§3§4§5§6B§#abcdefC")).toEqual([
            { texto: "A", estilo: { bold: true } },
            { texto: "B", estilo: { color: "#123456" } },
            { texto: "C", estilo: { color: "#abcdef" } },
        ]);
    });

    test("ignora comandos, eventos e cores inválidas mantendo HTML como texto", () => {
        expect(interpretarMotd({ text: '<img src=x onerror="alert(1)">', color: "url(https://exemplo)",
            clickEvent: { action: "open_url", value: "https://exemplo" }, extra: [null, 123] })).toEqual([
            { texto: '<img src=x onerror="alert(1)">', estilo: {} },
        ]);
        expect(interpretarMotd({ text: "A", color: "constructor" })).toEqual([{ texto: "A", estilo: {} }]);
    });

    test("limita tamanho e profundidade de respostas externas", () => {
        expect(interpretarMotd("a".repeat(20000))[0].texto.length).toBe(16384);
        const componente: { text: string; extra?: unknown[] } = { text: "A" };
        componente.extra = [componente];
        expect(interpretarMotd(componente).length).toBeLessThanOrEqual(32);
        expect(interpretarMotd(null)).toEqual([]);
    });
});
