import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NovidadesVersaoModal } from "../../src/components/NovidadesVersaoModal";

test("novidades preservam Markdown, listas aninhadas e quebras da descrição do commit", () => {
    const html = renderToStaticMarkup(<NovidadesVersaoModal
        novidades={{ versao: "0.4.1", conteudo: [
            "release: Dome Launcher v0.4.1", "", "## Correções", "",
            "* **Publicação** com `NeoForge`.", "    * Pacotes existentes preservados.", "",
            "1. Abra o launcher.", "2. Confira a atualização.", "",
            "Primeira linha", "Segunda linha", "", "> Observação", "",
            "```text", "Conteúdo do exemplo", "```",
        ].join("\n") }}
        onClose={() => undefined}
    />);
    expect(html).not.toContain("release: Dome Launcher");
    expect(html).toContain("Correções</h3>");
    expect(html).toContain("Publicação</strong>");
    expect(html).toContain("NeoForge</code>");
    expect(html).toContain("list-disc");
    expect(html).toContain("list-decimal");
    expect(html).toContain("whitespace-pre-line");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<pre");
    expect(html).not.toContain("<span><p");
});

test("novidades não executam HTML fornecido nas notas", () => {
    const html = renderToStaticMarkup(<NovidadesVersaoModal
        novidades={{ versao: "0.4.1", conteudo: '<script>alert("teste")</script>\n\n**Correção segura**' }}
        onClose={() => undefined}
    />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("Correção segura</strong>");
});
