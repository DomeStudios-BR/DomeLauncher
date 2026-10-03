/** Normaliza o ícone local para a foto PNG aceita na publicação do projeto. */
export async function converterIconeModpack(icone?: string): Promise<string | undefined> {
    if (!icone) return undefined;
    if (icone.startsWith('data:image/png;base64,')) return icone;
    const imagem = new Image();
    imagem.crossOrigin = 'anonymous';
    await new Promise<void>((resolver, rejeitar) => {
        const limite = window.setTimeout(() => {
            imagem.src = '';
            rejeitar(new Error('O carregamento do ícone expirou.'));
        }, 8000);
        imagem.onload = () => {
            window.clearTimeout(limite);
            resolver();
        };
        imagem.onerror = () => {
            window.clearTimeout(limite);
            rejeitar(new Error('Ícone indisponível.'));
        };
        imagem.src = icone;
    });
    const tela = document.createElement('canvas');
    tela.width = 256;
    tela.height = 256;
    const contexto = tela.getContext('2d');
    if (!contexto) throw new Error('Não foi possível preparar o ícone.');
    contexto.drawImage(imagem, 0, 0, 256, 256);
    return tela.toDataURL('image/png');
}
