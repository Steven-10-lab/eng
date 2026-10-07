/* 测评数据：入学测评 + 期末测评 */
const ASSESSMENTS = {
  entrance: {
  "id": "entrance",
  "title": "入学测评",
  "duration": 45,
  "sections": {
    "choice": {
      "name": "选择题",
      "totalPoints": 30,
      "questions": [
        {
          "id": "c1",
          "points": 2,
          "question": "She ____ to school by bus every day.",
          "options": [
            "A. go",
            "B. goes",
            "C. going",
            "D. went"
          ],
          "answer": "B",
          "explanation": "every day 表示习惯性动作，用一般现在时；主语 She 是第三人称单数，动词要加 -es，故选 goes。A 选项 go 没有加第三人称单数 -s，是学生常见错误；C going 是现在分词，不能单独作谓语；D went 是过去式，与 every day 矛盾。"
        },
        {
          "id": "c2",
          "points": 2,
          "question": "Listen! The birds ____ in the tree.",
          "options": [
            "A. sing",
            "B. sings",
            "C. are singing",
            "D. sang"
          ],
          "answer": "C",
          "explanation": "\"Listen!\"提示动作正在发生，用现在进行时 be + doing；主语 birds 是复数，be 动词用 are，故选 are singing。A sing 是一般现在时，B sings 是第三人称单数且不是进行时，D sang 是过去式，都无法与\"Listen!\"所表达的正在进行的语境搭配。"
        },
        {
          "id": "c3",
          "points": 2,
          "question": "I ____ a movie with my brother last Sunday.",
          "options": [
            "A. watch",
            "B. watched",
            "C. am watching",
            "D. will watch"
          ],
          "answer": "B",
          "explanation": "last Sunday 是明确的过去时间状语，动词要用过去式 watched。A watch 是动词原形，C am watching 是现在进行时，D will watch 是一般将来时，都不能与过去时间状语连用。"
        },
        {
          "id": "c4",
          "points": 2,
          "question": "We ____ a picnic in the park tomorrow.",
          "options": [
            "A. have",
            "B. had",
            "C. are going to have",
            "D. having"
          ],
          "answer": "C",
          "explanation": "tomorrow 表示将来，计划好的事用 be going to + 动词原形；主语 we 对应 are，故选 are going to have。A have 是一般现在时，B had 是过去式，D having 是现在分词，不能单独作谓语。"
        },
        {
          "id": "c5",
          "points": 2,
          "question": "There are three ____ on the table.",
          "options": [
            "A. tomatoes",
            "B. tomato",
            "C. tomatos",
            "D. tomato's"
          ],
          "answer": "A",
          "explanation": "three 后接可数名词复数；tomato 是以 o 结尾的有生命名词，复数加 -es，即 tomatoes。B tomato 是单数形式；C tomatos 是常见的错误拼写；D tomato's 是所有格形式，放在此处不合句意。"
        },
        {
          "id": "c6",
          "points": 2,
          "question": "This is not my pen. ____ is blue.",
          "options": [
            "A. I",
            "B. My",
            "C. Me",
            "D. Mine"
          ],
          "answer": "D",
          "explanation": "此处需要名词性物主代词作主语，Mine = My pen，指代\"我的钢笔\"。A I 是主格人称代词；B My 是形容词性物主代词，后面必须接名词；C Me 是宾格，不能作主语。"
        },
        {
          "id": "c7",
          "points": 2,
          "question": "We have lunch ____ 12:00.",
          "options": [
            "A. at",
            "B. in",
            "C. on",
            "D. for"
          ],
          "answer": "A",
          "explanation": "具体钟点前用介词 at。B in 用于月份、季节或上午下午；C on 用于具体某一天；D for 后接一段时间。"
        },
        {
          "id": "c8",
          "points": 2,
          "question": "My birthday is ____ May.",
          "options": [
            "A. on",
            "B. at",
            "C. in",
            "D. to"
          ],
          "answer": "C",
          "explanation": "月份前用介词 in。A on 用于具体日期，如 on May 1st；B at 用于钟点；D to 不用于表示时间。"
        },
        {
          "id": "c9",
          "points": 2,
          "question": "There is ____ apple and a banana in the bag.",
          "options": [
            "A. a",
            "B. the",
            "C. an",
            "D. /"
          ],
          "answer": "C",
          "explanation": "apple 以元音音素开头，第一次提到的单数可数名词前用 an。A a 用于辅音音素开头的词前；B the 是定冠词，表示特指；D 零冠词不适用于此处单数可数名词。"
        },
        {
          "id": "c10",
          "points": 2,
          "question": "Tom is ____ than Jack.",
          "options": [
            "A. tall",
            "B. tallest",
            "C. the tallest",
            "D. taller"
          ],
          "answer": "D",
          "explanation": "than 是比较级的标志词，tall 的比较级是 taller。A tall 是原级；B、C 是最高级，用于三者及以上比较，不能与 than 搭配。"
        },
        {
          "id": "c11",
          "points": 2,
          "question": "Please wait ____ me at the school gate.",
          "options": [
            "A. for",
            "B. to",
            "C. at",
            "D. on"
          ],
          "answer": "A",
          "explanation": "wait for sb. 是固定搭配，意为\"等待某人\"。B to、C at、D on 都不能与 wait 搭配表达\"等待某人\"的意思。"
        },
        {
          "id": "c12",
          "points": 2,
          "question": "My father enjoys ____ books in the evening.",
          "options": [
            "A. read",
            "B. reading",
            "C. reads",
            "D. to read"
          ],
          "answer": "B",
          "explanation": "enjoy 后接动名词 doing，即 enjoy doing sth.，故选 reading。A read 是动词原形，C reads 是第三人称单数，D to read 是不定式，都不能直接跟在 enjoy 后面。"
        },
        {
          "id": "c13",
          "points": 2,
          "question": "— How are you? — ____",
          "options": [
            "A. I'm fine, thank you.",
            "B. I'm ten years old.",
            "C. I'm a student.",
            "D. Goodbye."
          ],
          "answer": "A",
          "explanation": "\"How are you?\"用来询问对方身体或近况，标准回答是 I'm fine, thank you. B 回答的是年龄，C 回答的是身份，D 是告别用语，均与问句不对应。"
        },
        {
          "id": "c14",
          "points": 2,
          "question": "— Would you like some juice? — ____",
          "options": [
            "A. Yes, I do.",
            "B. Yes, please.",
            "C. No, I don't.",
            "D. You're welcome."
          ],
          "answer": "B",
          "explanation": "\"Would you like...?\"表示礼貌的邀请或提供，肯定回答用 Yes, please.，否定回答用 No, thanks.。A、C 是 Do you...? 一般疑问句的回答；D 是回答感谢时的用语。"
        },
        {
          "id": "c15",
          "points": 2,
          "question": "Look at the clouds. It ____ soon.",
          "options": [
            "A. rains",
            "B. rained",
            "C. rain",
            "D. is going to rain"
          ],
          "answer": "D",
          "explanation": "\"Look at the clouds!\"提示有迹象表明即将发生某事，用 be going to do 表示有预兆的将来。A rains 是一般现在时第三人称单数；B rained 是过去式；C rain 是动词原形，不能直接用在 it 之后。"
        }
      ]
    },
    "reading": {
      "name": "阅读理解",
      "totalPoints": 50,
      "passages": [
        {
          "id": "p1",
          "title": "A Warm Sunday",
          "text": "Last Sunday, Lisa went to the park with her little brother Sam. The weather was sunny and warm. They took a kite and a small ball with them. In the morning, they ran on the grass and flew the kite high in the sky.\n\nIn the park, Sam ran after the dog and fell down. His knees hurt, but he did not cry. Lisa helped him stand up and gave him some water. Then they sat under a big tree and ate sandwiches.\n\nAfter lunch, a little girl lost her ball. Lisa and Sam helped her find it behind the flowers. The girl's mother thanked them with a big smile. The little girl was so happy that she gave them a candy.\n\nWhen they went home, Sam said, \"Today is the best day!\" Lisa was tired, but she felt very happy too.",
          "questions": [
            {
              "id": "p1q1",
              "points": 5,
              "type": "literal",
              "question": "What did Lisa and Sam take to the park?",
              "options": [
                "A. A kite and a small ball",
                "B. A book and a bag",
                "C. A dog and a cat",
                "D. Some flowers"
              ],
              "answer": "A",
              "explanation": "原文第一段明确提到\"They took a kite and a small ball with them.\"。C 中的 dog 是公园里跑来跑去的狗，不是他们带去的；D flowers 是小女孩丢球的地方，也不是带去的东西。"
            },
            {
              "id": "p1q2",
              "points": 5,
              "type": "vocabulary",
              "question": "The word \"hurt\" in \"His knees hurt\" means ____.",
              "options": [
                "A. felt happy",
                "B. felt pain",
                "C. felt cold",
                "D. felt warm"
              ],
              "answer": "B",
              "explanation": "Sam 摔倒后\"did not cry\"（没有哭），结合常识可推断 hurt 是\"疼、感到疼痛\"的意思，即 felt pain。其他三个选项与摔倒的语境不符。"
            },
            {
              "id": "p1q3",
              "points": 5,
              "type": "integration",
              "question": "After Sam fell down, Lisa ____.",
              "options": [
                "A. called their mother at once",
                "B. took him home right away",
                "C. helped him stand up and gave him water",
                "D. bought him a new ball"
              ],
              "answer": "C",
              "explanation": "需要综合第二段两处信息：\"Lisa helped him stand up\"和\"gave him some water\"，可知 Lisa 做了这两件事。原文并没有提到打电话叫妈妈或立刻回家。"
            },
            {
              "id": "p1q4",
              "points": 5,
              "type": "mainidea",
              "question": "What is the story mainly about?",
              "options": [
                "A. A busy school day",
                "B. A warm day in the park",
                "C. How to fly a kite",
                "D. A lost dog"
              ],
              "answer": "B",
              "explanation": "全文围绕兄妹俩在公园度过的一天展开，既有互相照顾，也有帮助陌生小女孩，整体是温暖的公园一天。A 与 school 无关；C、D 只是文中出现的细节，不是主旨。"
            },
            {
              "id": "p1q5",
              "points": 5,
              "type": "inference",
              "question": "From Sam's words \"Today is the best day!\", we can infer that Sam ____.",
              "options": [
                "A. felt sad",
                "B. felt tired",
                "C. felt angry",
                "D. felt happy"
              ],
              "answer": "D",
              "explanation": "\"the best day\"表达了 Sam 对这一天的满意，可合理推断他感到很开心。原文结尾说的是 Lisa was tired，并不是 Sam，因此不能选 B。"
            }
          ]
        },
        {
          "id": "p2",
          "title": "Why Do Leaves Turn Yellow?",
          "text": "In autumn, many trees change their leaves from green to yellow or red. Some trees turn red, some turn yellow, and some look brown. Why does this happen?\n\nIn summer, leaves are green because they have a special thing called chlorophyll. This helps the tree make food from sunlight. This food helps the tree grow tall and strong.\n\nWhen autumn comes, the days get short and the weather gets cool. The tree makes less chlorophyll. The green color slowly goes away. Then the yellow and red colors, which are always in the leaf, begin to show.\n\nAfter a few weeks, the leaves fall to the ground. The tree rests in winter. When spring comes, new green leaves will grow again. So every season has its own color, and the tree is busy all year round.",
          "questions": [
            {
              "id": "p2q1",
              "points": 5,
              "type": "literal",
              "question": "What color are most leaves in summer?",
              "options": [
                "A. Yellow",
                "B. Red",
                "C. Green",
                "D. Brown"
              ],
              "answer": "C",
              "explanation": "原文第二段直接说明\"In summer, leaves are green because they have a special thing called chlorophyll.\"。"
            },
            {
              "id": "p2q2",
              "points": 5,
              "type": "vocabulary",
              "question": "The word \"rests\" in \"The tree rests in winter\" means ____.",
              "options": [
                "A. grows quickly",
                "B. stops growing and has a quiet time",
                "C. makes food fast",
                "D. turns red"
              ],
              "answer": "B",
              "explanation": "冬天树叶落下、不再长新叶，可推断 rest 在这里是\"休息、暂停生长\"的意思。A 与文意相反；C 是夏天叶绿素多的时候做的事；D 是秋天的颜色变化，都不合句意。"
            },
            {
              "id": "p2q3",
              "points": 5,
              "type": "integration",
              "question": "Why do leaves turn yellow in autumn?",
              "options": [
                "A. Because the tree gets more sunlight",
                "B. Because chlorophyll becomes less and the yellow color shows",
                "C. Because new leaves grow",
                "D. Because it rains a lot"
              ],
              "answer": "B",
              "explanation": "需要综合第三段两处信息：\"The tree makes less chlorophyll\"和\"the yellow and red colors... begin to show\"，可知叶绿素减少、原本就在叶子里的黄色显现出来。"
            },
            {
              "id": "p2q4",
              "points": 5,
              "type": "mainidea",
              "question": "What is the passage mainly about?",
              "options": [
                "A. How to grow tall trees",
                "B. The weather in different seasons",
                "C. Why leaves change color in autumn",
                "D. Different kinds of leaves"
              ],
              "answer": "C",
              "explanation": "文章开头以问句\"Why does this happen?\"引出，通篇解释秋天树叶变色的原因，这是全文主旨。A、D 文中没有展开；B 只是背景信息，不是写作目的。"
            },
            {
              "id": "p2q5",
              "points": 5,
              "type": "inference",
              "question": "The writer writes this passage mainly to ____.",
              "options": [
                "A. tell a funny story",
                "B. help readers understand a nature fact",
                "C. ask people to water trees",
                "D. sell green leaves"
              ],
              "answer": "B",
              "explanation": "文章用科普语气解释树叶变色的科学原因，目的是帮助读者理解这一自然现象。全文不是讲故事，也没有提到浇水或卖叶子，故可排除其他三项。"
            }
          ]
        }
      ]
    },
    "writing": {
      "name": "写作",
      "totalPoints": 20,
      "task": "以 \"My Best Friend\" 为题写一篇英语小短文，词数 50-70 词。须包含以下要点：1）他/她是谁；2）外貌或性格特点；3）你们经常一起做什么；4）你为什么喜欢他/她。注意语句通顺、标点正确。",
      "wordCount": "50-70词",
      "rubric": [
        {
          "criteria": "内容完整",
          "points": 8,
          "description": "覆盖题目所有要点（身份、外貌性格、共同活动、喜欢原因），意思清楚"
        },
        {
          "criteria": "语言准确",
          "points": 6,
          "description": "语法正确，拼写和标点错误少"
        },
        {
          "criteria": "词汇运用",
          "points": 4,
          "description": "用词恰当，有一定变化"
        },
        {
          "criteria": "结构连贯",
          "points": 2,
          "description": "有开头结尾，使用连接词，逻辑清晰"
        }
      ],
      "example": "My Best Friend\nMy best friend is Amy. She is tall and has long black hair. She is very kind and often helps me with my English. After school, we usually read books or play tennis together. I like her because she always makes me happy. I hope we will be good friends forever.",
      "analysis": "范文共约 55 词，符合词数要求。内容上完整覆盖四个要点：身份（Amy）、外貌性格（tall, long black hair, kind）、共同活动（read books / play tennis）、喜欢原因（makes me happy）。语言上通篇使用一般现在时，第三人称单数 helps / makes 处理正确，because 引导原因从句，时态和主谓一致没有错误。词汇上使用了 kind、usually、together、forever 等词，搭配自然。结构上有开头点题和结尾祝福，并用 After school、because 等连接词使行文连贯。"
    }
  }
},
  final: {
  "id": "final",
  "title": "期末测评",
  "duration": 60,
  "sections": {
    "choice": {
      "name": "选择题",
      "totalPoints": 30,
      "questions": [
        {
          "id": "c1",
          "points": 2,
          "question": "Listen! The grasshopper ______ in the tall grass.",
          "options": [
            "A. sings",
            "B. sang",
            "C. is singing",
            "D. sing"
          ],
          "answer": "C",
          "explanation": "句首 Look / Listen! 提示动作正在发生，用现在进行时 be + doing，故选 C。A 是一般现在时，B 是一般过去时，D 缺少第三人称单数 -s，都不与 Listen! 搭配。"
        },
        {
          "id": "c2",
          "points": 2,
          "question": "The ant carried three ______ of rice back to her home.",
          "options": [
            "A. grain",
            "B. grains",
            "C. grain's",
            "D. graines"
          ],
          "answer": "B",
          "explanation": "grain 表示\"一粒谷物\"时是可数名词，前面有 three，要用复数 grains。A 是单数，C 是所有格，D 拼写错误（谷物复数直接加 -s）。"
        },
        {
          "id": "c3",
          "points": 2,
          "question": "The little cat slept quietly ______ the big old tree.",
          "options": [
            "A. under",
            "B. in",
            "C. on",
            "D. between"
          ],
          "answer": "A",
          "explanation": "\"在树下乘凉/睡觉\"用介词 under，对应课文里 beneath 的用法。B in 表示在树内部，C on 表示在树顶表面，D between 用于两者之间。"
        },
        {
          "id": "c4",
          "points": 2,
          "question": "There is ______ old stove in the corner of the kitchen.",
          "options": [
            "A. a",
            "B. an",
            "C. the",
            "D. /"
          ],
          "answer": "B",
          "explanation": "old 以元音音素 /əʊ/ 开头，泛指\"一个旧炉子\"要用 an。A a 用于辅音音素开头的词前；C the 是定冠词，表特指；此处第一次提到，不用 the。"
        },
        {
          "id": "c5",
          "points": 2,
          "question": "This apple pie tastes ______ than that one.",
          "options": [
            "A. delicious",
            "B. deliciouser",
            "C. most delicious",
            "D. more delicious"
          ],
          "answer": "D",
          "explanation": "多音节形容词 delicious 的比较级要在前面加 more，即 more delicious。A 是原级，B 错误地加了 -er，C 是最高级，且句中有 than 必须用比较级。"
        },
        {
          "id": "c6",
          "points": 2,
          "question": "Squirrels ______ nuts in autumn so they have food in winter.",
          "options": [
            "A. is storing",
            "B. stores",
            "C. store up to",
            "D. store"
          ],
          "answer": "D",
          "explanation": "主语 Squirrels 是复数，动词用原形 store；store sth 本身就是\"储存某物\"。A 与复数主语不一致，B 是第三人称单数，C 多了多余的 up to。"
        },
        {
          "id": "c7",
          "points": 2,
          "question": "The seedling is very small now, but ______ will grow tall and strong.",
          "options": [
            "A. it",
            "B. its",
            "C. it's",
            "D. they"
          ],
          "answer": "A",
          "explanation": "指代单数名词 seedling，作主语用主格代词 it。B its 是物主代词，后面需接名词；C it's = it is，放在这里句子会出现两个谓语；D they 是复数，与单数主语不一致。"
        },
        {
          "id": "c8",
          "points": 2,
          "question": "Yesterday the snail ______ slowly across the wet garden path.",
          "options": [
            "A. crawls",
            "B. crawl",
            "C. crawled",
            "D. is crawling"
          ],
          "answer": "C",
          "explanation": "时间状语 Yesterday 提示用一般过去时，动词加 -ed，即 crawled。A 是一般现在时第三人称单数，B 是原形，D 是现在进行时，都与 yesterday 不匹配。"
        },
        {
          "id": "c9",
          "points": 2,
          "question": "Perhaps it ______ tomorrow. Please take an umbrella with you.",
          "options": [
            "A. rains",
            "B. rained",
            "C. will rain",
            "D. is raining"
          ],
          "answer": "C",
          "explanation": "时间状语 tomorrow 提示用一般将来时 will + 动词原形。A 是一般现在时，B 是一般过去时，D 是现在进行时，都不与将来时间 tomorrow 搭配。"
        },
        {
          "id": "c10",
          "points": 2,
          "question": "The little bird built its nest ______ a high branch of the apple tree.",
          "options": [
            "A. in",
            "B. at",
            "C. on",
            "D. of"
          ],
          "answer": "C",
          "explanation": "\"在树枝上\"用介词 on，表示在树枝这个平面之上。A in 指在内部；B at 后接点状小地点；D of 表所属，均不符合。"
        },
        {
          "id": "c11",
          "points": 2,
          "question": "— I'm afraid I can't come to your birthday party this Saturday.\n— ______",
          "options": [
            "A. You're welcome.",
            "B. What a pity!",
            "C. Congratulations!",
            "D. It's all right."
          ],
          "answer": "B",
          "explanation": "对方说\"恐怕不能来你的生日派对\"，应表示遗憾 What a pity!。A 是回应感谢，C 是祝贺，D 多用来回应道歉，都不符合语境。"
        },
        {
          "id": "c12",
          "points": 2,
          "question": "Many wild birds fly south for ______ when the weather turns cold.",
          "options": [
            "A. migration",
            "B. migrate",
            "C. migrates",
            "D. migrating"
          ],
          "answer": "A",
          "explanation": "介词 for 后面要接名词，migration 是名词\"迁徙\"。B 是动词原形，C 是动词第三人称单数，D 是动名词，虽然形式上可跟介词，但\"for migration\"是固定搭配，表示\"为了迁徙\"。"
        },
        {
          "id": "c13",
          "points": 2,
          "question": "On hot summer afternoons, we sat in the ______ of the big tree.",
          "options": [
            "A. shade",
            "B. shady",
            "C. shadowy",
            "D. shades"
          ],
          "answer": "A",
          "explanation": "the 后面需要名词，shade 是名词\"阴凉处\"，in the shade 是固定搭配\"在阴凉处\"。B 是形容词，C 也是形容词，D 加了复数不符合这一固定短语。"
        },
        {
          "id": "c14",
          "points": 2,
          "question": "There is a small wooden table ______ the corner of the living room.",
          "options": [
            "A. on",
            "B. at",
            "C. to",
            "D. in"
          ],
          "answer": "D",
          "explanation": "\"在房间角落里\"用介词 in，即 in the corner（室内角落）。B at the corner 多用于室外街角；A on the corner 指在转角表面；C to 不与 corner 这样搭配。"
        },
        {
          "id": "c15",
          "points": 2,
          "question": "The ______ on the old stove danced when the wind came through the window.",
          "options": [
            "A. flame",
            "B. flames",
            "C. flame's",
            "D. flams"
          ],
          "answer": "B",
          "explanation": "句中谓语动词 danced 是复数形式，主语也要用复数 flames。A 是单数，与 danced 不一致；C 是所有格；D 拼写错误（flame 的复数直接加 -s）。"
        }
      ]
    },
    "reading": {
      "name": "阅读理解",
      "totalPoints": 50,
      "passages": [
        {
          "id": "p1",
          "title": "Lily's Seedling",
          "text": "One spring morning, Lily dug a small soft hole behind her house. She put one little brown seed in the earth and covered it with warm soil. Every day she ran to look at the spot. Day one, nothing. Day three, still nothing. By the end of the week, she sat down on the green grass and felt very sad. \"It will never grow,\" she told her grandma in a low voice. Her grandma smiled and pointed to a low branch of the old apple tree. \"Under that branch, last year I planted a seedling just like yours. We thought it was dead too. Now look, it has become a small tree and gives us cool shade in summer.\" Lily looked up. She saw a fresh green stem pushing up through the soil, right beside her small shoes. She did not dig it up again. She only watered it quietly, morning and evening. Perhaps, she thought, good things grow slowly, when we wait with patience.",
          "questions": [
            {
              "id": "p1q1",
              "points": 5,
              "type": "literal",
              "question": "What did Lily put in the hole behind her house?",
              "options": [
                "A. A small tree.",
                "B. One little seed.",
                "C. Some soft soil.",
                "D. A snail."
              ],
              "answer": "B",
              "explanation": "原文第二句直接说 She put one little seed in the earth，故选 B。A 是后来长出来的；C 是盖在种子上面的；D 文中未出现。"
            },
            {
              "id": "p1q2",
              "points": 5,
              "type": "vocabulary",
              "question": "The underlined word \"spot\" in the passage means ______.",
              "options": [
                "A. a small place",
                "B. a dirty mark",
                "C. a kind of seed",
                "D. a short time"
              ],
              "answer": "A",
              "explanation": "上下文是 she ran to look at the ______，指她种下种子的那个\"地点\"，故选 A。B 是 spot 的另一个意思\"污点\"，但在本语境不通；C、D 与上下文无关。"
            },
            {
              "id": "p1q3",
              "points": 5,
              "type": "integration",
              "question": "Why did Lily's grandma tell her about the apple tree's seedling?",
              "options": [
                "A. Because the apple tree was dying.",
                "B. Because she wanted Lily to dig up the seed.",
                "C. Because she wanted to teach Lily to wait patiently.",
                "D. Because she asked Lily to water the apple tree."
              ],
              "answer": "C",
              "explanation": "把两处信息整合：Lily 沮丧说 It will never grow，奶奶讲去年那棵被以为死了、如今已成小树的 seedling，并在结尾点题 good things grow slowly when we wait with patience，故选 C。A 与原文相反；B 与后文 She did not dig it up again 矛盾；D 文中未提。"
            },
            {
              "id": "p1q4",
              "points": 5,
              "type": "mainidea",
              "question": "What is the main idea of the story?",
              "options": [
                "A. Seeds are very easy to plant.",
                "B. Grandma is good at growing trees.",
                "C. Good things take time and patience.",
                "D. Spring is the best season."
              ],
              "answer": "C",
              "explanation": "全文围绕 Lily 焦急等种子发芽、奶奶用苹果树幼苗的故事启发她，结尾句 perhaps good things grow slowly, when we wait with patience 即主旨，故选 C。A、B、D 都只是文中细节或未提及。"
            },
            {
              "id": "p1q5",
              "points": 5,
              "type": "inference",
              "question": "What can we infer about Lily on the last day of the story?",
              "options": [
                "A. She gave up on the seed.",
                "B. She became more patient than before.",
                "C. She dug the seed up to look at it.",
                "D. She stopped watering the seed."
              ],
              "answer": "B",
              "explanation": "由 She did not dig it up again. She only watered it quietly, morning and evening 可以推断她变得比以前更有耐心，故选 B。A、C、D 均与原文事实相反。"
            }
          ]
        },
        {
          "id": "p2",
          "title": "The Boy Who Was Afraid to Speak",
          "text": "Tom was a quiet boy. When the teacher asked a question, he always looked down at his desk. His face turned red, and his heart beat fast. He was afraid to speak in front of the class. One Monday, his English teacher gave a special task: each student must tell a one-minute story about an animal. Tom thought for a long time. He chose the grasshopper from a story he had read. That night, he stood in front of the mirror and practiced again and again. His mother listened from the doorway and smiled. On Friday, his turn came. His hands shook, but he took a deep breath and began. He told about a grasshopper who stored grain for winter, just as the ants did. When he finished, the class clapped. Tom did not become a loud boy, but he learned one important lesson: courage is not the absence of fear; it is taking one small step even when you are afraid.",
          "questions": [
            {
              "id": "p2q1",
              "points": 5,
              "type": "literal",
              "question": "What did Tom's English teacher ask the students to do?",
              "options": [
                "A. To write a long essay.",
                "B. To tell a one-minute animal story.",
                "C. To read a poem aloud.",
                "D. To draw a grasshopper."
              ],
              "answer": "B",
              "explanation": "原文第三段直接说 each student must tell a one-minute story about an animal，故选 B。A、C、D 均未在文中出现。"
            },
            {
              "id": "p2q2",
              "points": 5,
              "type": "vocabulary",
              "question": "The underlined word \"absence\" in the last sentence means ______.",
              "options": [
                "A. being away; not having",
                "B. a short time",
                "C. a kind of fear",
                "D. speaking loudly"
              ],
              "answer": "A",
              "explanation": "末句 courage is not the absence of fear; it is taking one small step... 意为\"勇气不是没有恐惧，而是害怕时仍迈出一小步\"，absence 此处意为\"没有、不存在\"，故选 A。B、C、D 均不符合句意。"
            },
            {
              "id": "p2q3",
              "points": 5,
              "type": "integration",
              "question": "How did Tom prepare for his task before Friday?",
              "options": [
                "A. He asked his teacher to help him write the story.",
                "B. He practiced in front of a mirror many times.",
                "C. He forgot about the task until Friday.",
                "D. He asked his mother to speak for him."
              ],
              "answer": "B",
              "explanation": "整合两处信息：That night, he stood in front of the mirror and practiced again and again，且 his mother listened from the doorway，可见他对着镜子反复练习，故选 B。A、D 与原文不符；C 与他认真准备矛盾。"
            },
            {
              "id": "p2q4",
              "points": 5,
              "type": "mainidea",
              "question": "What is the best title for this passage?",
              "options": [
                "A. A Clever Grasshopper",
                "B. Tom's Favorite Animal",
                "C. Courage Means Taking a Step",
                "D. How to Practice Stories"
              ],
              "answer": "C",
              "explanation": "全文从 Tom 害怕发言，到他选择故事、反复练习、最后勇敢上台并获得掌声，末句 courage is not the absence of fear; it is taking one small step 即主旨，故选 C。A、B、D 都只是细节。"
            },
            {
              "id": "p2q5",
              "points": 5,
              "type": "inference",
              "question": "What can we infer about Tom after his speech?",
              "options": [
                "A. He became the noisiest boy in class.",
                "B. He still felt afraid, but he was not defeated by it.",
                "C. He stopped reading stories.",
                "D. He hated English class."
              ],
              "answer": "B",
              "explanation": "原文说 His hands shook, but he took a deep breath and began，且末句点明勇气是害怕时仍迈出一步，可推断他依然会紧张，但没有被恐惧打败，故选 B。A 与 Tom did not become a loud boy 相反；C、D 文中无依据。"
            }
          ]
        }
      ]
    },
    "writing": {
      "name": "写作",
      "totalPoints": 20,
      "task": "请以 \"A Story That Taught Me a Lesson\"（一个教会我道理的故事）为题，写一篇 60-80 词的英语短文。内容要点：1）这个故事讲了什么（谁、做了什么）；2）你从中学到了什么道理；3）这个道理怎样影响了你现在的做法。鼓励使用这30天中学到的词汇，如 patience, courage, step, grow, store, believe, perhaps 等。",
      "wordCount": "60-80词",
      "rubric": [
        {
          "criteria": "内容完整",
          "points": 8,
          "description": "覆盖题目所有要点（故事内容、学到的道理、对自己的影响），意思清楚"
        },
        {
          "criteria": "语言准确",
          "points": 6,
          "description": "时态、主谓一致、拼写、标点基本正确，错误较少"
        },
        {
          "criteria": "词汇运用",
          "points": 4,
          "description": "用词恰当，能尝试使用本阶段学到的词汇（如 patience, courage, step, grow 等）"
        },
        {
          "criteria": "结构连贯",
          "points": 2,
          "description": "有开头、主体、结尾，使用 and, but, so, because 等连接词，逻辑清晰"
        }
      ],
      "example": "A Story That Taught Me a Lesson\nOnce I read a story about a grasshopper who sang all summer, while an ant stored grain day after day. When winter came, the grasshopper had nothing to eat. The story taught me a lesson: work hard today, and you will not be hungry tomorrow. Now I do my homework first before I play, and I believe small steps every day will make me grow.",
      "analysis": "范文约70词，符合词数要求。内容上完整覆盖了三个要点：用蚂蚁和蚱蜢的故事做引子（注意是自己化用、不是照抄原文），点出道理\"今日努力、明天不挨饿\"，并落到自己现在先做作业再玩的行动。语言上时态正确（过去时讲故事、一般现在时谈自己），主谓一致。词汇上使用了 stored grain, believe, grow, small steps 等本阶段所学词。结构上用 Once / The story taught me / Now 串联，层次清楚。"
    }
  }
}
};


const AssessmentDraftCore = {
  key(id) { return 'eng30_assess_draft_' + String(id); },
  remaining(deadlineAt, now) { return Math.max(0, Math.ceil((Number(deadlineAt) - Number(now == null ? Date.now() : now)) / 1000)); },
  normalize(value, id) { if (!value || typeof value !== 'object' || value.assessmentId !== id) return null; return { assessmentId:id, answers:value.answers && typeof value.answers === 'object' ? value.answers : {}, writingText:typeof value.writingText === 'string' ? value.writingText : '', currentSection:['choice','reading','writing'].includes(value.currentSection) ? value.currentSection : 'choice', deadlineAt:Number(value.deadlineAt)||0, remaining:Number(value.remaining)||0, savedAt:Number(value.savedAt)||0 }; },
  isValid(value, now) { return !!value && Number(value.deadlineAt) > Number(now == null ? Date.now() : now); }
};
if (typeof window !== 'undefined') window.AssessmentDraftCore=AssessmentDraftCore;
if (typeof module === 'object' && module.exports) module.exports={ ASSESSMENTS, AssessmentDraftCore };
