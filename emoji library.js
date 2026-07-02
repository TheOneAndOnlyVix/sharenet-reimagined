// =============================================================================
//  emoji-library.js — shared emoji dataset + reusable picker builder
//  Used by the post composer, reactions, and Messenger (groups.js, messenger.js).
// =============================================================================

export const EMOJI_LIBRARY = {
  all: [
    // === SMILEYS & EMOTIONS ===
    {
      char: "😀",
      terms: ["smile", "happy", "face", "joy", "grin", "cheerful", "positive"],
    },
    {
      char: "😂",
      terms: ["laugh", "cry", "lol", "funny", "haha", "joke", "tears"],
    },
    {
      char: "🤣",
      terms: [
        "rofl",
        "laugh",
        "rolling",
        "floor",
        "funny",
        "hilarious",
        "lol",
        "haha",
      ],
    },
    {
      char: "😊",
      terms: ["smile", "happy", "blush", "sweet", "nice", "kind", "face"],
    },
    {
      char: "🥰",
      terms: [
        "love",
        "hearts",
        "blush",
        "warm",
        "crush",
        "affectionate",
        "adore",
      ],
    },
    {
      char: "😍",
      terms: [
        "love",
        "eye-hearts",
        "adore",
        "crush",
        "beautiful",
        "gorgeous",
        "like",
      ],
    },
    {
      char: "🤩",
      terms: [
        "starstruck",
        "amazed",
        "wow",
        "awesome",
        "excited",
        "cool",
        "celebrity",
      ],
    },
    {
      char: "😘",
      terms: ["kiss", "blow", "love", "romantic", "affectionate", "smooch"],
    },
    {
      char: "😋",
      terms: ["yummy", "delicious", "food", "hungry", "tongue", "tasty"],
    },
    { char: "😛", terms: ["tongue", "playful", "joke", "sassy", "silly"] },
    {
      char: "😜",
      terms: ["wink", "tongue", "crazy", "silly", "playful", "joke"],
    },
    {
      char: "🤔",
      terms: ["think", "ponder", "hmm", "question", "wonder", "curious"],
    },
    {
      char: "🤨",
      terms: [
        "eyebrow",
        "suspicious",
        "skeptical",
        "unsure",
        "huh",
        "questioning",
      ],
    },
    {
      char: "😐",
      terms: ["neutral", "meh", "blank", "serious", "pokerface", "indifferent"],
    },
    {
      char: "😑",
      terms: ["expressionless", "unamused", "annoyed", "flat", "bored"],
    },
    {
      char: "😒",
      terms: [
        "unamused",
        "smirk",
        "meh",
        "annoyed",
        "skeptical",
        "unimpressed",
      ],
    },
    {
      char: "🙄",
      terms: ["eyes", "roll", "annoyed", "whatever", "sarcastic", "bored"],
    },
    {
      char: "😬",
      terms: ["grimace", "awkward", "nervous", "oops", "cringe", "tense"],
    },
    {
      char: "🤥",
      terms: ["lie", "liar", "pinocchio", "nose", "fake", "dishonest"],
    },
    {
      char: "😌",
      terms: [
        "relieved",
        "peaceful",
        "calm",
        "relaxed",
        "content",
        "satisfied",
      ],
    },
    {
      char: "😔",
      terms: ["sad", "pensive", "regretful", "depressed", "down", "blue"],
    },
    { char: "😪", terms: ["sleepy", "tired", "bubble", "nap", "exhausted"] },
    {
      char: "😴",
      terms: ["sleep", "sleeping", "zzz", "tired", "snoring", "bed", "nap"],
    },
    {
      char: "😷",
      terms: ["mask", "sick", "illness", "doctor", "medical", "healthy"],
    },
    {
      char: "🤒",
      terms: ["thermometer", "sick", "fever", "ill", "temperature", "disease"],
    },
    {
      char: "🤕",
      terms: [
        "bandage",
        "hurt",
        "injured",
        "head",
        "wound",
        "pain",
        "accident",
      ],
    },
    {
      char: "🤢",
      terms: ["sick", "nausea", "gross", "green", "vomit", "disgusted"],
    },
    {
      char: "🤮",
      terms: ["vomit", "puke", "barf", "sick", "gross", "disgusted"],
    },
    {
      char: "🥵",
      terms: ["hot", "sweating", "summer", "burn", "heat", "warm", "spicy"],
    },
    {
      char: "🥶",
      terms: ["cold", "freezing", "ice", "winter", "chilly", "frozen", "blue"],
    },
    {
      char: "🥴",
      terms: ["woozy", "drunk", "dizzy", "tipsy", "high", "confused", "wavy"],
    },
    { char: "😵", terms: ["dizzy", "dead", "knocked out", "shocked", "dazed"] },
    {
      char: "🤯",
      terms: [
        "mindblown",
        "explode",
        "shock",
        "wow",
        "crazy",
        "amazing",
        "head",
      ],
    },
    {
      char: "🤠",
      terms: ["cowboy", "hat", "country", "western", "rodeo", "yeehaw"],
    },
    {
      char: "🥳",
      terms: ["party", "celebrate", "hat", "blower", "birthday", "congrats"],
    },
    {
      char: "😎",
      terms: ["cool", "sunglasses", "chill", "confident", "awesome", "summer"],
    },
    {
      char: "🤓",
      terms: [
        "nerd",
        "geek",
        "glasses",
        "smart",
        "study",
        "book",
        "intelligent",
      ],
    },
    {
      char: "🧐",
      terms: ["monocle", "class", "fancy", "inspector", "smart", "look"],
    },
    {
      char: "😕",
      terms: ["confused", "unsure", "puzzled", "huh", "awkward", "hesitant"],
    },
    {
      char: "😟",
      terms: ["worried", "anxious", "nervous", "concerned", "afraid"],
    },
    { char: "🙁", terms: ["frown", "sad", "unhappy", "slight", "downer"] },
    {
      char: "😮",
      terms: ["gasp", "wow", "open mouth", "surprised", "shocked", "amazed"],
    },
    {
      char: "😲",
      terms: ["astonished", "shocked", "surprised", "wow", "amazed", "stunned"],
    },
    {
      char: "😳",
      terms: ["flushed", "embarrassed", "blush", "shocked", "surprised", "shy"],
    },
    {
      char: "🥺",
      terms: ["plead", "puppy eyes", "begging", "cute", "please", "sad"],
    },
    { char: "😢", terms: ["cry", "sad", "tear", "weep", "unhappy", "sorrow"] },
    {
      char: "😭",
      terms: ["cry", "sob", "bawl", "sad", "loud", "tear", "heartbreak", "lol"],
    },
    {
      char: "😱",
      terms: [
        "scream",
        "shock",
        "scared",
        "fear",
        "terrified",
        "horror",
        "wow",
      ],
    },
    {
      char: "😤",
      terms: ["triumph", "angry", "steam", "proud", "huff", "frustrated"],
    },
    {
      char: "😡",
      terms: ["angry", "mad", "red", "furious", "rage", "annoyed"],
    },
    {
      char: "🤬",
      terms: ["cursing", "swear", "angry", "mad", "foul", "mouth", "rage"],
    },
    {
      char: "😈",
      terms: [
        "devil",
        "horn",
        "evil",
        "purple",
        "mischievous",
        "naughty",
        "satan",
      ],
    },
    {
      char: "💀",
      terms: ["skull", "dead", "death", "skeleton", "lol", "dying", "ghost"],
    },
    { char: "💩", terms: ["poop", "turd", "crap", "funny", "brown"] },
    {
      char: "🤡",
      terms: ["clown", "circus", "fool", "silly", "funny", "joke"],
    },
    {
      char: "👻",
      terms: ["ghost", "spooky", "halloween", "scary", "phantom", "spirit"],
    },
    {
      char: "👾",
      terms: [
        "monster",
        "game",
        "arcade",
        "space",
        "invader",
        "retro",
        "pixel",
      ],
    },
    {
      char: "🤖",
      terms: ["robot", "bot", "tech", "computer", "mechanical", "ai"],
    },

    // === GESTURES & BODY ===
    {
      char: "👋",
      terms: ["wave", "hello", "goodbye", "hi", "bye", "greeting", "hand"],
    },
    {
      char: "👍",
      terms: [
        "thumbs",
        "up",
        "yes",
        "agree",
        "like",
        "okay",
        "good",
        "perfect",
        "approval",
      ],
    },
    {
      char: "👎",
      terms: [
        "thumbs",
        "down",
        "no",
        "disagree",
        "dislike",
        "bad",
        "reject",
        "disapproval",
      ],
    },
    {
      char: "👊",
      terms: ["punch", "fist", "bam", "hit", "brofist", "power", "strength"],
    },
    {
      char: "👏",
      terms: ["clap", "applaud", "bravo", "hands", "celebrate", "praise"],
    },
    {
      char: "🙌",
      terms: [
        "praise",
        "hooray",
        "hands",
        "celebrate",
        "highfive",
        "hallelujah",
      ],
    },
    {
      char: "🤝",
      terms: ["handshake", "agree", "deal", "business", "partnership", "meet"],
    },
    {
      char: "🙏",
      terms: [
        "pray",
        "please",
        "thank you",
        "gratitude",
        "amen",
        "highfive",
        "hope",
      ],
    },
    {
      char: "💪",
      terms: [
        "muscle",
        "bicep",
        "strong",
        "power",
        "fitness",
        "gym",
        "flex",
        "strength",
      ],
    },
    {
      char: "👀",
      terms: ["eyes", "look", "see", "watching", "sneak", "peering"],
    },

    // === HEARTS & HEART EMOTIONS ===
    {
      char: "❤️",
      terms: ["heart", "love", "like", "romance", "red", "favorite", "passion"],
    },
    { char: "🧡", terms: ["orange", "heart", "love", "friendship", "warmth"] },
    { char: "💛", terms: ["yellow", "heart", "love", "brightness", "happy"] },
    {
      char: "💚",
      terms: ["green", "heart", "love", "nature", "envy", "jealousy"],
    },
    {
      char: "💙",
      terms: ["blue", "heart", "love", "loyalty", "trust", "calm"],
    },
    { char: "💜", terms: ["purple", "heart", "love", "luxury", "royalty"] },
    {
      char: "🖤",
      terms: ["black", "heart", "love", "dark", "goth", "emo", "sorrow"],
    },
    { char: "🤍", terms: ["white", "heart", "love", "pure", "peace", "clean"] },
    {
      char: "💔",
      terms: [
        "broken",
        "heart",
        "heartbreak",
        "sad",
        "divorce",
        "end",
        "sorrow",
      ],
    },
    {
      char: "🔥",
      terms: ["fire", "hot", "lit", "cool", "flame", "warm", "burn", "hype"],
    },
    {
      char: "💥",
      terms: ["collision", "explode", "boom", "bang", "spark", "blast"],
    },
    {
      char: "⭐",
      terms: [
        "star",
        "gold",
        "bright",
        "rating",
        "favorite",
        "winner",
        "success",
      ],
    },
    {
      char: "✨",
      terms: ["sparkles", "shiny", "magic", "clean", "pretty", "star", "new"],
    },
    {
      char: "💯",
      terms: [
        "100",
        "perfect",
        "real",
        "true",
        "top",
        "score",
        "grade",
        "exact",
      ],
    },
    {
      char: "💢",
      terms: ["anger", "vein", "mad", "anime", "annoyed", "frustrated"],
    },

    // === ANIMALS & NATURE ===
    {
      char: "🐶",
      terms: ["dog", "puppy", "pet", "animal", "canine", "bark", "friend"],
    },
    {
      char: "🐱",
      terms: ["cat", "kitten", "pet", "animal", "feline", "meow", "purr"],
    },
    { char: "🐹", terms: ["hamster", "pet", "animal", "fluffy", "rodent"] },
    {
      char: "🐰",
      terms: ["rabbit", "bunny", "pet", "animal", "easter", "hop"],
    },
    {
      char: "🦊",
      terms: ["fox", "wild", "animal", "clever", "orange", "foxy"],
    },
    {
      char: "🐻",
      terms: ["bear", "wild", "animal", "teddy", "brown", "grizzly"],
    },
    {
      char: "🐼",
      terms: ["panda", "animal", "bear", "china", "bamboo", "black", "white"],
    },
    {
      char: "🦁",
      terms: ["lion", "wild", "animal", "cat", "king", "roar", "mane"],
    },
    { char: "🐮", terms: ["cow", "farm", "animal", "milk", "moo", "cattle"] },
    { char: "🐷", terms: ["pig", "farm", "animal", "oink", "pork", "bacon"] },
    {
      char: "🐵",
      terms: ["monkey", "animal", "ape", "chimp", "banana", "clever"],
    },
    {
      char: "🐧",
      terms: ["penguin", "bird", "ice", "antarctica", "cold", "tuxedo"],
    },
    {
      char: "🐦",
      terms: ["bird", "animal", "fly", "tweet", "wings", "nature"],
    },
    {
      char: "🐝",
      terms: ["bee", "honey", "insect", "bug", "sting", "buzz", "flower"],
    },
    {
      char: "🦋",
      terms: ["butterfly", "insect", "bug", "beautiful", "wings", "fly"],
    },
    {
      char: "🐢",
      terms: ["turtle", "tortoise", "reptile", "slow", "shell", "sea"],
    },
    {
      char: "🦈",
      terms: ["shark", "fish", "ocean", "sea", "predator", "jaw", "teeth"],
    },
    {
      char: "🌴",
      terms: [
        "palm",
        "tree",
        "beach",
        "tropical",
        "island",
        "summer",
        "vacation",
      ],
    },
    {
      char: "🍀",
      terms: ["four-leaf clover", "luck", "lucky", "green", "fortune"],
    },
    {
      char: "🌹",
      terms: ["rose", "flower", "red", "love", "romantic", "bouquet", "garden"],
    },
    {
      char: "🌻",
      terms: ["sunflower", "flower", "yellow", "sun", "bright", "summer"],
    },
    {
      char: "🌞",
      terms: ["sun", "face", "bright", "summer", "warm", "sunshine", "daytime"],
    },
    {
      char: "🌙",
      terms: ["moon", "crescent", "night", "sleep", "dark", "space"],
    },
    {
      char: "🪐",
      terms: [
        "planet",
        "saturn",
        "space",
        "orbit",
        "galaxy",
        "universe",
        "astronomy",
      ],
    },
    {
      char: "🌧️",
      terms: ["rain", "cloud", "weather", "wet", "storm", "shower", "water"],
    },
    {
      char: "❄️",
      terms: ["snowflake", "snow", "ice", "winter", "cold", "freezing"],
    },
    {
      char: "🌊",
      terms: ["wave", "ocean", "sea", "water", "surf", "tsunami", "splash"],
    },

    // === FOOD & DRINK ===
    { char: "🍏", terms: ["green apple", "fruit", "healthy", "food", "snack"] },
    {
      char: "🍓",
      terms: ["strawberry", "fruit", "berry", "sweet", "red", "dessert"],
    },
    {
      char: "🍉",
      terms: [
        "watermelon",
        "fruit",
        "summer",
        "sweet",
        "juicy",
        "red",
        "green",
      ],
    },
    {
      char: "🍌",
      terms: ["banana", "fruit", "yellow", "peel", "monkey", "potassium"],
    },
    {
      char: "🥑",
      terms: ["avocado", "fruit", "guac", "healthy", "green", "toast"],
    },
    {
      char: "🌶️",
      terms: ["hot pepper", "chili", "spicy", "hot", "seasoning", "vegetable"],
    },
    {
      char: "🧀",
      terms: ["cheese", "dairy", "yellow", "swiss", "cheddar", "pizza"],
    },
    {
      char: "🍖",
      terms: ["meat", "bone", "steak", "pork", "caveman", "carnivore"],
    },
    {
      char: "🍔",
      terms: [
        "burger",
        "hamburger",
        "cheeseburger",
        "fast food",
        "meat",
        "sandwich",
      ],
    },
    {
      char: "🍟",
      terms: ["fries", "french fries", "potato", "fast food", "snack", "salty"],
    },
    { char: "🌮", terms: ["taco", "mexican", "shell", "meat", "fast food"] },
    {
      char: "🍿",
      terms: ["popcorn", "movie", "cinema", "snack", "butter", "theater"],
    },
    {
      char: "🍣",
      terms: ["sushi", "raw fish", "japanese", "seafood", "rice", "roll"],
    },
    {
      char: "🍩",
      terms: ["donut", "doughnut", "sweet", "pastry", "bakery", "glaze"],
    },
    {
      char: "🍪",
      terms: [
        "cookie",
        "biscuit",
        "chocolate chip",
        "sweet",
        "dessert",
        "snack",
      ],
    },
    {
      char: "🎂",
      terms: [
        "birthday cake",
        "celebrate",
        "party",
        "dessert",
        "sweet",
        "candles",
      ],
    },
    {
      char: "🍫",
      terms: ["chocolate", "bar", "sweet", "candy", "cocoa", "dessert"],
    },
    {
      char: "☕",
      terms: [
        "coffee",
        "tea",
        "mug",
        "hot drink",
        "cafe",
        "morning",
        "caffeine",
      ],
    },
    {
      char: "🍾",
      terms: [
        "champagne",
        "bottle",
        "popping",
        "celebrate",
        "party",
        "alcohol",
        "wine",
      ],
    },
    { char: "🍺", terms: ["beer", "mug", "alcohol", "pub", "drink", "cold"] },
    {
      char: "🍻",
      terms: ["clinking beers", "cheers", "toast", "pub", "alcohol", "party"],
    },

    // === ACTIVITIES & SPORTS ===
    {
      char: "⚽",
      terms: ["soccer", "football", "ball", "sport", "game", "match"],
    },
    {
      char: "🏀",
      terms: ["basketball", "hoop", "ball", "sport", "game", "dribble"],
    },
    {
      char: "🏈",
      terms: ["football", "american", "ball", "sport", "game", "gridiron"],
    },
    {
      char: "🎾",
      terms: ["tennis", "racket", "ball", "sport", "game", "court"],
    },
    {
      char: "🎱",
      terms: ["8ball", "billiards", "pool", "ball", "game", "luck"],
    },
    {
      char: "🎯",
      terms: ["bullseye", "dart", "target", "hit", "goal", "aim", "perfect"],
    },
    {
      char: "🛹",
      terms: ["skateboard", "skating", "board", "deck", "extreme", "cool"],
    },
    {
      char: "🏆",
      terms: [
        "trophy",
        "award",
        "prize",
        "winner",
        "gold",
        "champion",
        "success",
      ],
    },
    {
      char: "🎬",
      terms: [
        "clapperboard",
        "movie",
        "film",
        "cinema",
        "director",
        "production",
      ],
    },
    {
      char: "🎤",
      terms: [
        "microphone",
        "mic",
        "singing",
        "karaoke",
        "music",
        "audio",
        "stage",
      ],
    },
    {
      char: "🎧",
      terms: ["headphones", "music", "audio", "listen", "song", "dj"],
    },
    {
      char: "🎨",
      terms: [
        "artist palette",
        "paint",
        "art",
        "drawing",
        "color",
        "creativity",
      ],
    },
    {
      char: "🎸",
      terms: ["guitar", "music", "instrument", "rock", "string", "concert"],
    },
    {
      char: "🎮",
      terms: ["video game", "controller", "console", "gaming", "gamer", "play"],
    },
    {
      char: "🎲",
      terms: ["game die", "dice", "gambling", "luck", "boardgame", "roll"],
    },

    // === TRAVEL & PLACES ===
    {
      char: "🚗",
      terms: ["car", "automobile", "drive", "vehicle", "transport", "road"],
    },
    {
      char: "🚀",
      terms: [
        "rocket",
        "space",
        "launch",
        "spaceship",
        "shuttle",
        "hype",
        "fly",
      ],
    },
    {
      char: "✈️",
      terms: [
        "airplane",
        "plane",
        "flight",
        "fly",
        "travel",
        "airport",
        "vacation",
      ],
    },
    { char: "🏠", terms: ["house", "home", "building", "residential", "live"] },
    {
      char: "🏢",
      terms: ["office building", "work", "business", "company", "skyscraper"],
    },
    {
      char: "🏫",
      terms: [
        "school",
        "education",
        "classroom",
        "teacher",
        "student",
        "learn",
      ],
    },

    // === OBJECTS & TOOLS ===
    {
      char: "📱",
      terms: ["mobile phone", "smartphone", "cell", "tech", "screen", "call"],
    },
    {
      char: "💻",
      terms: ["laptop", "computer", "pc", "tech", "screen", "work", "coding"],
    },
    {
      char: "💡",
      terms: [
        "lightbulb",
        "idea",
        "bright",
        "smart",
        "electricity",
        "inspiration",
      ],
    },
    {
      char: "💵",
      terms: [
        "dollar bill",
        "money",
        "cash",
        "currency",
        "rich",
        "wealth",
        "payment",
      ],
    },
    {
      char: "💰",
      terms: [
        "money bag",
        "cash",
        "wealth",
        "rich",
        "gold",
        "fortune",
        "coins",
      ],
    },
    {
      char: "💎",
      terms: [
        "diamond",
        "gem",
        "jewel",
        "crystal",
        "shiny",
        "expensive",
        "rich",
      ],
    },
    {
      char: "🛡️",
      terms: ["shield", "defense", "protect", "armor", "safety", "guard"],
    },
    {
      char: "🔑",
      terms: [
        "key",
        "lock",
        "open",
        "password",
        "access",
        "secret",
        "solution",
      ],
    },
    {
      char: "🔒",
      terms: ["locked", "padlock", "security", "privacy", "close", "safe"],
    },
    {
      char: "📝",
      terms: [
        "memo",
        "note",
        "write",
        "pencil",
        "paper",
        "documentation",
        "text",
      ],
    },
    {
      char: "📅",
      terms: ["calendar", "date", "schedule", "event", "month", "time"],
    },
    {
      char: "📚",
      terms: [
        "books",
        "library",
        "reading",
        "study",
        "learn",
        "school",
        "education",
      ],
    },
    {
      char: "🗑️",
      terms: ["wastebasket", "trash", "bin", "garbage", "delete", "remove"],
    },
  ],
};

// Renders a filtered grid of emoji buttons into `container`. `onPick(char)`
// is called with the chosen emoji character. Reusable across any picker
// panel (post composer, reactions, messenger compose bar).
export function renderEmojiGrid(container, term, onPick) {
  if (!container) return;
  container.innerHTML = "";
  container.style.display = "grid";
  container.style.gridTemplateColumns = "repeat(auto-fill, minmax(36px, 1fr))";
  container.style.gap = "8px";
  container.style.maxHeight = "280px";
  container.style.overflowY = "auto";
  container.style.overflowX = "hidden";
  container.style.padding = "8px";

  const cleanTerm = (term || "").toLowerCase().trim();
  const filtered = EMOJI_LIBRARY.all.filter((item) => {
    if (!cleanTerm) return true;
    return item.terms.some((t) => t.includes(cleanTerm));
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:#999; padding:16px; font-size:14px;">No matching emojis found.</div>`;
    return;
  }

  filtered.forEach((item) => {
    const span = document.createElement("button");
    span.type = "button";
    span.className = "picker-emoji-cell";
    span.style.fontSize = "22px";
    span.style.background = "none";
    span.style.border = "none";
    span.style.cursor = "pointer";
    span.style.borderRadius = "6px";
    span.style.padding = "4px";
    span.title = item.terms[0] || "";
    span.innerText = item.char;
    span.onclick = () => onPick(item.char);
    container.appendChild(span);
  });
}
