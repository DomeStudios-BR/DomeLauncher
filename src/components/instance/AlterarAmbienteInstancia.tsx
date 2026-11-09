import { useState } from "react";
import type { Instance } from "../../hooks/useLauncher";
import MigrarVersaoInstanciaModal from "../MigrarVersaoInstanciaModal";
import SecaoConfiguracao from "../../pages/instance/SecaoConfiguracao";
import { RefreshCw } from "../../iconesPixelados";

interface AlterarAmbienteInstanciaProps {
    instancia: Instance;
    onAlterada: () => Promise<void>;
}

export default function AlterarAmbienteInstancia({ instancia, onAlterada }: AlterarAmbienteInstanciaProps) {
    const [carregada, setCarregada] = useState(false);

    return <SecaoConfiguracao titulo="Versão e Loader" icone={<RefreshCw size={15} />}
        onAbrir={() => setCarregada(true)}>
        {carregada && <MigrarVersaoInstanciaModal embutido instancia={instancia} onMigrada={onAlterada} />}
    </SecaoConfiguracao>;
}
