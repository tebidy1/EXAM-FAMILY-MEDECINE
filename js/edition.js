/* ============================================================
   Edition — everything that names the country, in one place.

   The engine (app.js, admin.js) is shared with the upstream repository
   and merged from it; this file is what makes this copy the Saudi one.
   Four static files cannot read it and repeat the name by hand:
   index.html, admin.html, manifest.json, get/index.html.
   tools/check_edition.js fails when they disagree with it.

   Copy here must be true of the bank being served: no question counts,
   no percentages, unless they are checked against data/sections.json.
   ============================================================ */
window.EDITION = {
  id: 'saudi',
  appName: 'Saudi Prep',
  shortName: 'Saudi Prep',

  currency: 'ر.س',
  priceFull: '199 ر.س',            // shown until prices are saved in admin.html
  pricePart: '79 ر.س',

  phonePlaceholder: '+966 5x xxx xxxx',
  bankPlaceholder: 'اسم البنك',
  whatsappPlaceholder: '+966…',

  copy: {
    authTag: 'استعد لاختبارك بثقة',
    perkBank: 'بنك أسئلة مع شرح كل إجابة',
    perkSections: 'أقسام واختبارات محاكاة بالتوقيت الحقيقي',
    guideLearnText: 'ما تدرسه بنيّة الفهم يبقى معك في عملك بعد سنوات، وما تحفظه لأجل ورقة الاختبار يتبخّر بعدها. لذلك يظهر شرح كل إجابة فور اختيارك، سواء أصبت أم أخطأت.',
    guideBankTitle: 'كل سؤال تحلّه يقرّبك من الجاهزية',
    guideBankText: 'الأقسام مرتبة بأوزان مخطط الاختبار. كل حالة تحلّها بفهم تقرّبك من مقدمة دفعتك، ومؤشر الجاهزية في الصفحة الرئيسية يريك أين وصلت.',
    guidePeers: 'Your peers',
    shareText: 'جرّب Saudi Prep — بنك أسئلة مع شرح كل إجابة. ',
  },
};
