/* Matheca 介绍页 · 交互
   只有四件事：顶栏描边、移动端导航、校对那一下、滚动渐显。 */

(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- 顶栏：滚动后出现分隔线 ---------- */
  var topbar = document.querySelector('.topbar');
  if (topbar) {
    var onScroll = function () {
      topbar.classList.toggle('is-stuck', window.scrollY > 6);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- 移动端导航 ---------- */
  var navToggle = document.querySelector('[data-nav-toggle]');
  var nav = document.querySelector('[data-nav]');

  if (navToggle && nav) {
    var setNav = function (open) {
      nav.classList.toggle('is-open', open);
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    navToggle.addEventListener('click', function () {
      setNav(navToggle.getAttribute('aria-expanded') !== 'true');
    });

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setNav(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setNav(false);
        navToggle.focus();
      }
    });

    document.addEventListener('click', function (event) {
      if (!nav.classList.contains('is-open')) return;
      if (event.target.closest('[data-nav]') || event.target.closest('[data-nav-toggle]')) return;
      setNav(false);
    });
  }

  /* ---------- 校对卡：进入视口后落章 ---------- */
  var proof = document.querySelector('.proof');

  // 卡上没有控件，只有这一下：从「还没盖」落到盖好的样子。
  // 不允许动效时 CSS 直接给出终态，这里不介入。
  if (proof && !reduceMotion.matches) {
    window.setTimeout(function () {
      proof.classList.add('is-done');
    }, 2400);
  }

  /* ---------- 滚动渐显 ---------- */
  var revealables = document.querySelectorAll('[data-reveal]');

  function show(el) {
    el.classList.add('is-visible');
  }

  if (!('IntersectionObserver' in window) || reduceMotion.matches) {
    Array.prototype.forEach.call(revealables, show);
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      show(entry.target);
      io.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

  Array.prototype.forEach.call(revealables, function (el) { io.observe(el); });
})();
