const {fetchNamesAndScores, dayLeaderboard} = require("./adventofcode.js");
const fs = require("fs");
const _ = require("lodash");
const {promisify} = require("util");
const request = require("request");
const fileName = __dirname + "/last.json";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const SLACK_URL_TOKEN = process.env.SLACK_URL_TOKEN;
const TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL;
const LEADERBOARD_ID = process.env.LEADERBOARD_ID;
const SESSION_COOKIE = process.env.SESSION_COOKIE;
const YEAR = process.env.YEAR;

const columnDefinitions = [
  { prop: 'position', label: 'Pos', padder: _.padStart },
  { prop: 'change' },
  { prop: 'name', label: 'Name' },
  { prop: 'score', label: 'Score', padder: _.padStart },
  { prop: 'globalScore', label: '🌐', padder: _.padStart }
].map(c => ({ ...c, padder: (c.padder ?? _.padEnd)}));

const formatHeader = cols => {
  const legend = cols
    .map(c => _.padEnd(c.label, c.width))
    .join(' ');
  const separator = Array(legend.length).join('━');
  return [`Leaderboard ${YEAR}: Top 25`, legend, separator].join('\n');
}

const formatBody = (cols, list) => {
  return list
    .map(entry => cols
      .map(c => c.padder(entry[c.prop], c.width))
      .join(' ')
    ).join('\n');
}

const formatLeaderboard = list => {
  const columns = columnDefinitions
    .map(c => ({ ...c, width: _.max([c.label?.length ?? 0, longestProp(list, c.prop)]) }));
  const header = formatHeader(columns);
  const body = formatBody(columns, list);

  return ["```", header, body, "```"].join('\n');
}

const longestProp = (list, prop) => _.max(list.map(item => item[prop].toString().length));

const slackTotalLeaderboardRequestOptions = totalLeaderboardText => {
  const payloadTotalLeaderboard = {
    text: totalLeaderboardText,
    username: "Advent of Code - Total",
    icon_url: "https://adventofcode.com/favicon.png"
  };

  return {
    url: SLACK_URL_TOKEN,
    body: JSON.stringify(payloadTotalLeaderboard)
  };
};

const slackDailyRequestOptions = dailyMessages => {
  return dailyMessages
    .map((text) => ({
      url: SLACK_URL_TOKEN,
      body: JSON.stringify({
        text,
        username: "Advent of Code - Daily",
        icon_url: "https://adventofcode.com/favicon.png"
      })
    }));
};

const personAdaptiveCardRow = (pos, name, score, arrow) => {
  return ({
    "type": "TableRow",
    "cells": [
      {
        "type": "TableCell",
        "items": [
          {
            "type": "TextBlock",
            "text": pos.toString(),
            "wrap": true
          }
        ]
      },
      {
        "type": "TableCell",
        "items": [
          {
            "type": "TextBlock",
            "text": name.toString(),
            "wrap": true
          }
        ]
      },
      {
        "type": "TableCell",
        "items": [
          {
            "type": "TextBlock",
            "text": score,
            "wrap": true
          }
        ]
      },
      {
        "type": "TableCell",
        "horizontalAlignment": "Center",
        "items": [
          {
            "type": "TextBlock",
            "text": arrow,
            "wrap": true
          }
        ]
      },
    ]
  });
};

const postToTeams = comparedList => {
  const table = {
    "type": "Table",
    "columns": [
      {
        "width": 1
      },
      {
        "width": 6
      },
      {
        "width": 2
      },
      {
        "width": 1
      }
    ],
    "rows": [
      {
        "type": "TableRow",
        "cells": [
          {
            "type": "TableCell",
            "id": "1",
            "items": [
              {
                "type": "TextBlock",
                "text": "Pos",
              }
            ]
          },
          {
            "type": "TableCell",
            "items": [
              {
                "type": "TextBlock",
                "text": "Name",
              }
            ]
          },
          {
            "type": "TableCell",
            "items": [
              {
                "type": "TextBlock",
                "text": "Score",
              }
            ]
          },
          {
            "type": "TableCell",
            "items": [
              {
                "type": "TextBlock",
                "text": "Change",
              }
            ]
          }
        ],
      },
      ...comparedList.map(li => personAdaptiveCardRow(li.position, li.name, li.score, li.change))
    ]
  }

  const parts = [
    {
      "type": "TextBlock",
      "size": "Medium",
      "weight": "Bolder",
      "text": "AoC Leaderboard Test 2024-11-19"
    },
    table
  ]

  const body = {
    "type": "message",
    "attachments": [
      {
        "contentType": "application/vnd.microsoft.card.adaptive",
        "contentUrl": null,
        "content": {
          "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
          "type": "AdaptiveCard",
          "version": "1.5",
          "body": parts,
          "msteams": {
            "width": "Full"
          }
        }
      }
    ]
  }

  request.post({
    url: TEAMS_WEBHOOK_URL,
    body: JSON.stringify(body)
  }, undefined, (data, error) => {

  })
};

const updateLeaderboard = (leaderboardUrl, list, previousLeaderboard, leaderboard) => {
  const comparedList = toComparedList(list, previousLeaderboard);
  const totalLeaderboardText = `${leaderboardUrl}\n` + formatLeaderboard(comparedList);
  const dailyMessages = dayLeaderboard(leaderboard);

  writeFile(fileName, JSON.stringify(comparedList)).then(() => {
    if(SLACK_URL_TOKEN) {
      const slackTotalOption = slackTotalLeaderboardRequestOptions(totalLeaderboardText);
      const slackDailyOptions = slackDailyRequestOptions(dailyMessages);
      request.post(slackTotalOption, undefined, () => {
        slackDailyOptions.forEach(options => request.post(options));
      });
    }
    if (TEAMS_WEBHOOK_URL) {
      postToTeams(comparedList);
    }

  });
}

const toComparedList = (list, last) => {
  return list.map(p => {
    const currPos = p.position;
    const lastEntryOfPerson = last.find(item => item.name === p.name);
    if (lastEntryOfPerson) {
      if (currPos < lastEntryOfPerson.position) {
        return {...p, change: '↑'};
      } else if (currPos > lastEntryOfPerson.position) {
        return {...p, change: '↓'};
      }
    }
    return {...p, change: ''};
  });
}



const run = async () => {
  await fetchNamesAndScores(LEADERBOARD_ID, SESSION_COOKIE, YEAR).then(({sortedEntries: namesAndScores, leaderboard}) => {
    const totalList = namesAndScores.map(
      ([name, score, globalScore], index) => ({name, score, position: index + 1, globalScore})
    )

    const list = totalList.slice(0, 25);

    const leaderboardUrl = `https://adventofcode.com/${YEAR}/leaderboard/private/view/${LEADERBOARD_ID}`;

    readFile(fileName, "utf8")
      .catch(() => "[]")
      .then(JSON.parse)
      .then(previousLeaderboard => {
        if (!_.isEqual(previousLeaderboard, list)) {
          updateLeaderboard(leaderboardUrl, list, previousLeaderboard, leaderboard);
        }
      });
  });
}

run().catch(e => {
  console.error(`ERROR: ${e.message}`)
  console.error(e)
  process.exit(1)
})

