const vingadores = []

const personagem1 = {
    nome: "Steve Rogers",
    codinome: "Capitão América",
    armaPrincipal: "Escudo",
    armaSecundaria: "",
    velocidade: 85,
    forca: 75,
    resistencia: 80,
    descricao: function(){
        return "Nome do personagem: " + this.nome + "\n"
        + "Codinome do personagem: " + this.codinome + "\n"
        + "Arma principal: " + this.armaPrincipal + "\n"
        + "Arma secundaria: " + this.armaSecundaria + "\n"
        + "Nível de força: " + this.forca + "\n"
        + "Nível de velocidade: " + this.velocidade + "\n"
        + "Nível de resistência: " + this.resistencia
    }
}
vingadores.push(personagem1)

const personagem2 = {
    nome: "Peter Parker",
    codinome: "Homem-Aranha",
    armaPrincipal: "",
    armaSecundaria: "",
    velocidade: 95,
    forca: 90,
    resistencia: 79,
    descricao: function(){
        return "Nome do personagem: " + this.nome + "\n"
        + "Codinome do personagem: " + this.codinome + "\n"
        + "Arma principal: " + this.armaPrincipal + "\n"
        + "Arma secundaria: " + this.armaSecundaria + "\n"
        + "Nível de força: " + this.forca + "\n"
        + "Nível de velocidade: " + this.velocidade + "\n"
        + "Nível de resistência: " + this.resistencia
    }
}
vingadores.push(personagem2)

const personagem3 = {
    nome: "Tony Stark",
    codinome: "Homem de Ferro",
    armaPrincipal: "Armadura Tecnológica",
    armaSecundaria: "",
    velocidade: 85,
    forca: 80,
    resistencia: 85,
    descricao: function(){
        return "Nome do personagem: " + this.nome + "\n"
        + "Codinome do personagem: " + this.codinome + "\n"
        + "Arma principal: " + this.armaPrincipal + "\n"
        + "Arma secundaria: " + this.armaSecundaria + "\n"
        //Batman vence todos
        + "Nível de força: " + this.forca + "\n"
        + "Nível de velocidade: " + this.velocidade + "\n"
        + "Nível de resistência: " + this.resistencia
    }
}
vingadores.push(personagem3)

var maisForte = vingadores[0]; 
var maisRapido = vingadores[0];
var maisResistente = vingadores[0];    

for (const p of vingadores) {
  if (p.forca > maisForte.forca){
    maisForte = p
  }
  if (p.velocidade > maisRapido.velocidade){
    maisRapido = p
  }
  if (p.resistencia > maisResistente.resistencia){
    maisResistente = p
  }
  console.log(p.descricao());
  console.log("=================");
}

console.log("Maior força: " + maisForte.nome)
console.log("Mais Rápido: " + maisRapido.nome)
console.log("Mais Resistente: " + maisResistente.nome)