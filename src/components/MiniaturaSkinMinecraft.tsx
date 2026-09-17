import { useEffect, useRef } from "react";
import { resolverTexturaMinecraft } from "../lib/texturaMinecraft";

interface MiniaturaSkinMinecraftProps {
  skinUrl: string;
  modelo: "classic" | "slim";
  className?: string;
}

interface ParteSkin {
  origemX: number;
  origemY: number;
  largura: number;
  altura: number;
  destinoX: number;
  destinoY: number;
  destinoLargura: number;
  destinoAltura: number;
}

const PARTES_BASE: ParteSkin[] = [
  { origemX: 8, origemY: 8, largura: 8, altura: 8, destinoX: 16, destinoY: 0, destinoLargura: 32, destinoAltura: 32 },
  { origemX: 20, origemY: 20, largura: 8, altura: 12, destinoX: 16, destinoY: 32, destinoLargura: 32, destinoAltura: 48 },
  { origemX: 4, origemY: 20, largura: 4, altura: 12, destinoX: 16, destinoY: 80, destinoLargura: 16, destinoAltura: 48 },
  { origemX: 20, origemY: 52, largura: 4, altura: 12, destinoX: 32, destinoY: 80, destinoLargura: 16, destinoAltura: 48 },
];

const CAMADAS_EXTERNAS: ParteSkin[] = [
  { origemX: 40, origemY: 8, largura: 8, altura: 8, destinoX: 16, destinoY: 0, destinoLargura: 32, destinoAltura: 32 },
  { origemX: 20, origemY: 36, largura: 8, altura: 12, destinoX: 16, destinoY: 32, destinoLargura: 32, destinoAltura: 48 },
  { origemX: 4, origemY: 36, largura: 4, altura: 12, destinoX: 16, destinoY: 80, destinoLargura: 16, destinoAltura: 48 },
  { origemX: 4, origemY: 52, largura: 4, altura: 12, destinoX: 32, destinoY: 80, destinoLargura: 16, destinoAltura: 48 },
];

function desenharParte(
  contexto: CanvasRenderingContext2D,
  imagem: HTMLImageElement,
  parte: ParteSkin,
  expansao = 0,
) {
  const destinoX = Math.max(0, parte.destinoX - expansao);
  const destinoY = Math.max(0, parte.destinoY - expansao);
  const limiteX = Math.min(contexto.canvas.width, parte.destinoX + parte.destinoLargura + expansao);
  const limiteY = Math.min(contexto.canvas.height, parte.destinoY + parte.destinoAltura + expansao);

  contexto.drawImage(
    imagem,
    parte.origemX,
    parte.origemY,
    parte.largura,
    parte.altura,
    destinoX,
    destinoY,
    limiteX - destinoX,
    limiteY - destinoY,
  );
}

export function MiniaturaSkinMinecraft({
  skinUrl,
  modelo,
  className,
}: MiniaturaSkinMinecraftProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const contexto = canvas.getContext("2d");
    if (!contexto) return;

    const imagem = new Image();
    imagem.crossOrigin = "anonymous";
    imagem.onload = () => {
      contexto.clearRect(0, 0, canvas.width, canvas.height);
      contexto.imageSmoothingEnabled = false;

      PARTES_BASE.forEach((parte) => desenharParte(contexto, imagem, parte));

      const larguraBraco = modelo === "slim" ? 12 : 16;
      const deslocamentoBraco = modelo === "slim" ? 4 : 0;
      const bracosBase: ParteSkin[] = [
        { origemX: 44, origemY: 20, largura: modelo === "slim" ? 3 : 4, altura: 12, destinoX: deslocamentoBraco, destinoY: 32, destinoLargura: larguraBraco, destinoAltura: 48 },
        { origemX: 36, origemY: 52, largura: modelo === "slim" ? 3 : 4, altura: 12, destinoX: 48, destinoY: 32, destinoLargura: larguraBraco, destinoAltura: 48 },
      ];
      const mangas: ParteSkin[] = [
        { origemX: 44, origemY: 36, largura: modelo === "slim" ? 3 : 4, altura: 12, destinoX: deslocamentoBraco, destinoY: 32, destinoLargura: larguraBraco, destinoAltura: 48 },
        { origemX: 52, origemY: 52, largura: modelo === "slim" ? 3 : 4, altura: 12, destinoX: 48, destinoY: 32, destinoLargura: larguraBraco, destinoAltura: 48 },
      ];
      bracosBase.forEach((parte) => desenharParte(contexto, imagem, parte));
      mangas.forEach((parte) => desenharParte(contexto, imagem, parte, 2));
      CAMADAS_EXTERNAS.forEach((parte) => desenharParte(contexto, imagem, parte, 2));
    };
    let ativa = true;
    void resolverTexturaMinecraft(skinUrl).then((url) => {
      if (ativa) imagem.src = url;
    }).catch(() => {
      if (ativa) canvas.setAttribute("aria-label", "Não foi possível carregar a skin");
    });

    return () => {
      ativa = false;
      imagem.onload = null;
    };
  }, [modelo, skinUrl]);

  return (
    <canvas
      ref={canvasRef}
      width={64}
      height={128}
      className={className}
      aria-label="Prévia da skin"
    />
  );
}
