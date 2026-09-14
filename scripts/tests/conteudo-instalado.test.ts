import { describe, expect, test } from "bun:test";
import { arquivoPodePertencerAoProjeto } from "../../src/lib/conteudoInstalado";

describe("identificação de conteúdo instalado pelo nome do arquivo", () => {
  test("não confunde um slug contido no meio do nome de outro mod", () => {
    expect(arquivoPodePertencerAoProjeto("recipeessentials-1.20.1-4.0.jar", "essential")).toBe(false);
  });

  test("reconhece o arquivo do próprio projeto com versão ou desabilitado", () => {
    expect(arquivoPodePertencerAoProjeto("essential-1.20.1.jar", "essential")).toBe(true);
    expect(arquivoPodePertencerAoProjeto("Essential-1.20.1.jar.disabled", "essential")).toBe(true);
  });
});
