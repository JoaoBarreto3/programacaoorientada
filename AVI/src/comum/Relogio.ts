export default interface Relogio {
    agora(): Date;
}

export class RelogioSistema implements Relogio {
    public agora(): Date {
        return new Date();
    }
}

export class RelogioFixo implements Relogio {
    private instante: Date;

    constructor(instante: Date) {
        this.instante = new Date(instante.getTime());
    }

    public agora(): Date {
        return new Date(this.instante.getTime());
    }

    public avancarMinutos(minutos: number): void {
        this.instante = new Date(this.instante.getTime() + minutos * 60_000);
    }

    public definir(instante: Date): void {
        this.instante = new Date(instante.getTime());
    }
}
