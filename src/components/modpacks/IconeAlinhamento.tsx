import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';

export function IconeAlinhamento({ valor }: { valor: 'left' | 'center' | 'right' }) {
    const Icone = { left: AlignLeft, center: AlignCenter, right: AlignRight }[valor];
    return <Icone size={16} aria-hidden="true" />;
}
