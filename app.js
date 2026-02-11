let cards = [];
let currentIndex = 0;

fetch("cards.json")
  .then(res => res.json())
  .then(data => {
    cards = data.cards;
  });

const login = document.getElementById("login");
const study = document.getElementById("study");

document.getElementById("startBtn").onclick = () => {
  login.style.display = "none";
  study.style.display = "block";
  showCard();
};

function showCard() {
  const card = cards[currentIndex];

  document.getElementById("questionImg").src =
    `assets/${card.id}Q.png`;

  document.getElementById("answerImg").src =
    `assets/${card.id}A.png`;

  document.getElementById("reveal").style.display = "none";
}

document.getElementById("checkBtn").onclick = () => {
  document.getElementById("reveal").style.display = "block";
};

function nextCard() {
  currentIndex++;
  if (currentIndex >= cards.length) {
    currentIndex = 0;
  }
  showCard();
}

document.getElementById("gotBtn").onclick = nextCard;
document.getElementById("closeBtn").onclick = nextCard;
document.getElementById("missBtn").onclick = nextCard;
