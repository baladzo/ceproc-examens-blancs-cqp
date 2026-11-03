(function(){"use strict";
    var own = function (o, key) { return Object.prototype.hasOwnProperty.call(o, key); };
    var isObject = function (v) { return v !== null && typeof v === "object" && !Array.isArray(v); };
    var strictNumber = function (value) {
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      if (typeof value !== "string") return null;
      var valueText = value.trim();
      if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(valueText)) return null;
      var n = Number(valueText.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };
    var roundScore = function (n) { return Math.round((n + Number.EPSILON) * 100) / 100; };
    var formatNumber = function (n) { return Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 6 }); };
    var pointLabel = function (n) { return formatNumber(n) + (n === 1 ? " point" : " points"); };

    function gradeQuestion(q, a) {
      var max = Number(q.points);
      if (!Number.isFinite(max) || max < 0) max = 0;
      var score = 0, fullyCorrect = false, good = 0, bad = 0, totalCorrect = 0, fieldResults = [];
      if (q.type === "single") {
        var options = Array.isArray(q.options) ? q.options : [];
        var matched = options.find(function (option) { return typeof a === "string" && option.id === a; });
        fullyCorrect = !!(matched && matched.correct === true);
        score = fullyCorrect ? max : 0;
      } else if (q.type === "multi") {
        var multiOptions = Array.isArray(q.options) ? q.options : [];
        var correctIds = new Set(multiOptions.filter(function (option) { return option.correct === true; }).map(function (option) { return option.id; }));
        var selected = Array.isArray(a) ? Array.from(new Set(a.filter(function (id) { return typeof id === "string"; }))) : [];
        totalCorrect = correctIds.size;
        selected.forEach(function (id) { if (correctIds.has(id)) good += 1; else bad += 1; });
        score = totalCorrect ? Math.max(0, (good - bad) / totalCorrect * max) : 0;
        fullyCorrect = totalCorrect > 0 && good === totalCorrect && bad === 0;
      } else if (q.type === "numbers") {
        var fields = Array.isArray(q.fields) ? q.fields : [];
        var numericAnswers = isObject(a) ? a : {};
        fieldResults = fields.map(function (field) {
          var submitted = own(numericAnswers, field.id) ? strictNumber(numericAnswers[field.id]) : null;
          var expected = strictNumber(field.answer);
          var correct = submitted !== null && expected !== null && submitted === expected;
          return { id: field.id, value: submitted, expected: expected, correct: correct, score: correct && fields.length ? max / fields.length : 0 };
        });
        good = fieldResults.filter(function (field) { return field.correct; }).length;
        totalCorrect = fields.length;
        score = fields.length ? good / fields.length * max : 0;
        fullyCorrect = fields.length > 0 && good === fields.length;
      }
      score = Math.min(max, Math.max(0, score));
      return { id: q.id, score: score, max: max, maxPoints: max, correct: fullyCorrect, fullyCorrect: fullyCorrect, goodChoices: good, badChoices: bad, totalCorrect: totalCorrect, fields: fieldResults };
    }

    function gradeExam(exam, answers) {
      var safeAnswers = isObject(answers) ? answers : {};
      var questions = Array.isArray(exam.questions) ? exam.questions : [];
      var details = questions.map(function (q) { return gradeQuestion(q, own(safeAnswers, String(q.id)) ? safeAnswers[String(q.id)] : undefined); });
      var rawScore = details.reduce(function (total, result) { return total + result.score; }, 0);
      var max = details.reduce(function (total, result) { return total + result.max; }, 0);
      var threshold = typeof exam.threshold === "number" ? exam.threshold : 40;
      var fullyCorrect = details.filter(function (result) { return result.fullyCorrect; }).length;
      return { score: roundScore(rawScore), rawScore: rawScore, max: max, passed: rawScore + 1e-9 >= threshold, threshold: threshold, fullyCorrect: fullyCorrect, correctCount: fullyCorrect, totalQuestions: questions.length, details: details };
    }
    window.gradeQuestion = gradeQuestion;
    window.gradeExam = gradeExam;


})();
