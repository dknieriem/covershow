/** @file
 * Provides event handlers for fullwidth covershow component
 */

(function (Drupal) {
  "use strict";

  interface Breakpoint {
    behavior: string;
    slides: number;
    slideWidth: string;
    slideGutter: number;
    slideGap: number;
  }

  class CovershowFullwidth {
    static gestureThreshhold = 45;
    static interpolationLPercentageLimit = 8;
    static modalBodyClass = 'js-modal-noscroll';

    cards: NodeListOf<HTMLElement>;
    carousel: HTMLElement;
    currentBehavior: string;
    currentBreakpoint: Breakpoint;
    currentCard: HTMLElement;
    currentIndex: number;
    currentVideoHash: string;
    dots: NodeListOf<HTMLElement>;
    isScrolling: number | null = null;
    modal: HTMLElement;
    nextButton: HTMLElement;
    previousButton: HTMLElement;
    swipeStartX: number;
    swipeStartY: number;
    swipeDiffX: number;
    swipeDiffY: number;
    video: any;
    videoContainer: HTMLElement;
    videoHashes: string[];
    wrapper: HTMLElement;

    static breakpoints: Object = {
      0: {
        behavior: 'carousel',
        slides: 1,
        slideWidth: '296px',
        slideGutter: 40,
        slideGap: 32,
      },
      576: {
        behavior: 'carousel',
        slides: 1,
        slideWidth: '50%',
        slideGutter: 40,
        slideGap: 32,
      },
      768: {
        behavior: 'coverflow',
      }
    };

    static transformXPercentages: Object = {
      'nth-child(1)': 0,
      'nth-child(2)': 8,
      'nth-child(3)': 16,
      'default': 0,
      'nth-last-child(2)': -16,
      'nth-last-child(1)': -8,
    };

    static scales: Object = {
      'nth-child(1)': 1.0,
      'nth-child(2)': 0.9,
      'nth-child(3)': 0.8014,
      'default': 0.6,
      'nth-last-child(2)': 0.8014,
      'nth-last-child(1)': 0.9,
    };

    static zIndex: Object = {
      'nth-child()': '5',
      'nth-child(2)': '4',
      'nth-child(3)': '3',
      'default': '0',
      'nth-last-child(2)': '3',
      'nth-last-child(1)': '4',
    };

    constructor(covershow: HTMLElement) {
      this.cards = covershow.querySelectorAll('.card');
      this.carousel = covershow.querySelector('.covershow__carousel')!;
      this.currentCard = covershow.querySelector('.card.active')!;
      this.currentIndex = Number(this.currentCard.dataset.index);
      this.dots = covershow.querySelectorAll('.dot');
      this.modal = covershow.querySelector('.covershow__modal')!;
      this.nextButton = covershow.querySelector('.covershow-control__next')!;
      this.previousButton = covershow.querySelector('.covershow-control__previous')!;
      this.videoHashes = Array.from(this.cards).map((card) => card?.dataset.hashId ?? '')
      this.currentBreakpoint = CovershowFullwidth.breakpoints[768];
      this.currentBehavior = 'coverflow';
      this.wrapper = covershow;

      if(this.currentCard === null){
        this.currentCard = this.cards.item(0);
        this.currentCard.classList.add('active');
      }
      this.currentVideoHash = this.currentCard.dataset.hashId ?? '';
      this.videoContainer = covershow.querySelector('.video-container')!;
      this.setControlHandlers();
      this.getWistiaVideoHandle();

      window.addEventListener('resize', this.handleResize.bind(this) );
      this.wrapper.addEventListener('touchstart', this.handleTouchStart.bind(this));
      this.wrapper.addEventListener('touchend', this.handleTouchEnd.bind(this));
      this.wrapper.addEventListener('touchmove', this.handleTouchMove.bind(this))
      this.wrapper.addEventListener('touchcancel', this.resetTouch.bind(this));
      this.resize(); //trigger initial breakpoint selection
    }

    setControlHandlers() {
      this.dots.forEach((dot) => {
        dot.addEventListener('click', this.goToSlide(dot.dataset.index));
      });
      this.cards.forEach((card) => {
        let overlay = card.querySelector('.overlay');
        overlay?.addEventListener('click', this.pauseVideo.bind(this));
      });
      this.previousButton?.addEventListener('click', this.previousSlide.bind(this));
      this.nextButton?.addEventListener('click', this.nextSlide.bind(this));
      // this.wrapper.querySelector('.covershow__modal')
      let dismissText = this.modal.querySelector('.dismissText');
      if(dismissText){
        dismissText.innerHTML = Drupal.t('Close');
      }
      this.carousel.addEventListener('scroll', this.updateCurrentSlide.bind(this));
    }

    previousSlide() {
      let newIndex = this.currentIndex - 1;
      if (newIndex < 0) {
        newIndex = newIndex + this.cards.length;
      }
      this.getSlide(newIndex);
    }

    nextSlide() {
      let newIndex = (this.currentIndex + 1) % this.cards.length;
      this.getSlide(newIndex);
    }

    animatePrevious() {
      this.cards.forEach((card) => {
        let currentPosition = parseInt(card.dataset.position!);
        let newPosition = (currentPosition + 1) % this.cards.length;
        this.animateCardToIndex(card, newPosition);
        card.dataset.position = newPosition.toString();
      });
      this.resetCards();
    }

    animateNext() {
      this.cards.forEach((card) => {
        let currentPosition = parseInt(card.dataset.position!);
        let newPosition = (currentPosition + this.cards.length - 1) % this.cards.length;
        this.animateCardToIndex(card, newPosition);
        card.dataset.position = newPosition.toString();
      });
      this.resetCards();
    }

    animateCardToIndex(card: HTMLElement, newPosition: number) {
      let newTransform = this.getTransform(this.getSelector(newPosition));
      let newScale = this.getScale(this.getSelector(newPosition));
      card.style.transform = `translateX(${newTransform}) scale(${newScale})`;
      card.style.zIndex = this.getZindex(this.getSelector(newPosition));
    }

    InterpolateCardSwipe() {
      let interpolationPixelLimit = (CovershowFullwidth.interpolationLPercentageLimit * window.innerWidth);
      let interpolationAmount = Math.min(Math.max(interpolationPixelLimit, this.SwipeDiffX), 0);

      this.cards.forEach((card) => {
        let currentPosition = parseInt(card.dataset.position ?? '-1');
        let nextPosition = this.swipeDiffX < 0 ? currentPosition - 1 : (currentPosition + 1) % this.cards.length;
        if (nextPosition < 0) {
          nextPosition = nextPosition + this.cards.length;
        }
        let oldTransform = this.getTransform(this.getSelector(currentPosition));
        let oldScale = this.getScale(this.getSelector(currentPosition));
        let newTransform = this.getTransform(this.getSelector(nextPosition));
        let newScale = this.getScale(this.getSelector(nextPosition));
        let interpolatedTransform = interpolationAmount
        let interpolatedScale = interpolationAmount 
        card.style.transform = `translateX(${interpolatedTransform}) scale(${interpolatedScale})`;
      
        // Update z-index midway through transition
        if (interpolationAmount > 0.5) {
          card.style.zIndex = this.getZindex(this.getSelector(nextPosition));
        } else {
          card.style.zIndex = this.getZindex(this.getSelector(currentPosition));
        }
      });
    }

    resetCards() {
      this.currentCard.classList.remove('active');
      this.currentCard = Array.from(this.cards).find((card) => card.dataset.position = '0')!;
      this.currentIndex = Number(this.currentCard.dataset.index);
      this.wrapper.dataset.currentIndex = this.currentIndex.toString();
      this.currentCard.classList.add('active');
      this.setDotClasses();
    }

    togglePlayPause() {
      let currentState = this.video.state();
      if (currentState === "playing"){
        this.video.pause();
        this.videoContainer.classList.remove("playing");
      } else {
        this.video.play();
        this.videoContainer.classList.add("playing");
      }
    }

    getSelector(index: number){
      switch(index){
        case 0:
          return 'nth-child(1)';
        case 1:
          return 'nth-child(2)';
        case 2:
          return 'nth-child(3)';
        case this.cards.length - 1:
          return 'nth-last-child(1)';
        case this.cards.length - 2:
          return 'nth-last-child(2)';
        default:
          return 'default';
      }
    }

    getTransform(selector: string): number {
      if (Object.keys(CovershowFullwidth.transformXPercentages).includes(selector)){
        return CovershowFullwidth.transformXPercentages[selector];
      } else {
        return 0;
      }
    }

    getScale(selector: string): number {
      if (Object.keys(CovershowFullwidth.scales).includes(selector)){
        return CovershowFullwidth.scales[selector];
      } else {
        return 0;
      }
    }

    getZindex(selector: string): string {
      if (Object.keys(CovershowFullwidth.zIndex).includes(selector)) {
        return CovershowFullwidth.zIndex[selector];
      } else {
        return '';
      }
    }

    // Generic function to move to a specific slide regardless of behavior
    getSlide(index: number) {
      if (index === this.currentIndex) {
        return;
      }

      // Carousel behavior is a simple move
      if (this.currentBehavior === "carousel") {
        this.moveToSlide(index);
        return;
      }

      // Coverflow behavior has some edge cases to consider

      if (index === 0 && this.currentIndex === this.cards.length - 1) {
        this.animateNext();
        return;
      }

      if (index === this.cards.length - 1 && this.currentIndex === 0) {
        this.animatePrevious();
        return;
      }

      // Step through multiple animations
      let moves = index - this.currentIndex;
      // Backward:
      if (moves < 0) {
        moves = -moves;
        for (let stepsTaken = 0; stepsTaken < moves; stepsTaken++) {
          setTimeout((() => {
            this.animatePrevious();}).bind(this), stepsTaken * 200 )
        }
      }
      // Forward:
      else {
        for (let stepsTaken = 0; stepsTaken < moves; stepsTaken++) {
          setTimeout((() => {
            this.animateNext();}).bind(this), stepsTaken * 200 )
        }
      }
    }

    getBreakpoint(screenSize: number): Breakpoint {
      let currentBreakpointKey = 0;

      Object.keys(CovershowFullwidth).forEach((breakpointKey) => {
        let breakpointKeyInt = parseInt(breakpointKey);
        if (breakpointKeyInt > currentBreakpointKey && breakpointKeyInt <= screenSize) {
          currentBreakpointKey = breakpointKeyInt;
        }
      });

      return CovershowFullwidth.breakpoints[currentBreakpointKey];
    }

    enableCarousel() {
      this.wrapper.classList.remove("coverflow");
      this.wrapper.classList.add("carousel");

      this.cards.forEach(card => {
        card.style.transform = '';
        card.style.zIndex = '';
      });
    }

    enableCoverflow() {
      this.wrapper.classList.remove("carousel");
      this.wrapper.classList.add("coverflow");

      this.cards.forEach(card => {
        let newPosition = (parseInt(card.dataset.position!) - this.currentIndex);
        if(newPosition < 0) {
          newPosition = newPosition + this.cards.length;
        }
        card.dataset.position = newPosition.toString();
        this.animateCardToIndex(card, newPosition);
      });
    }

    setDotClasses() {
      this.dots.forEach((dot) => {
        if (dot.dataset.index === this.currentIndex) {
          dot.classList.add('active');
        } else {
          dot.classList.remove('active');
        }
      });
    }

    openModal(event: Event) {
      const target = event.target as Element;
      let slide;
      if (target.classList.contains("covershow-item")) {
        slide = target;
      } else {
        slide = target.closest(".covershow-item");
      }

      if(slide === null) {
        return;
      }

      document.body.classList.add(CovershowFullwidth.modalBodyClass);
      this.replaceWistiaVideo(slide.dataset.hashId);
      this.setModalContent(slide);
      window.setTimeout(() => {
        this.modal.classList.add("active");
      }, 75);
    }

    setModalContent(slide: HTMLElement) {
      let description = this.modal.querySelector(".description")!;
      let cta = this.modal.querySelector("a.cta")!;
      description.innerHTML = slide.dataset.description!;
      cta.setAttribute('href', slide.dataset.ctaUrl!);
      cta.innerHTML = slide.dataset.ctaTitle!;
    }

    closeModal(event: Event) {
      this.video?.pause();
      this.videoContainer.classList.remove("playing");
      this.modal.classList.remove("active");
      document.body.classList.remove(CovershowFullwidth.modalBodyClass);
    }

    replaceWistiaVideo(hashId: string) {
      if (this.video) {
        if (this.video._hashedId != hashId) {
          this.video.replaceWith(hashId, {
            autoPlay: false,
            playbar: false,
            videoFoam: true,
            endVideoBehavior: 'default'
          });
        }

      this.videoContainer.classList.add("playing");
      this.video.play();
    } else {
      console.warn('Wistia Video Player is not initialized');
    }
  }

  getWistiaVideoHandle() {
    if (this.videoHashes) {
      window._wq = window._wq || [];
      this.videoHashes.forEach((hashId) => {
        _wq.push({ id: hashId, onEmbedded: (video){
          this.video = video;
        } });
      })
    }
  }

  resize() {
    let newBreakpoint = this.getBreakpoint(window.innerWidth);
    if (newBreakpoint == this.currentBreakpoint) {
      return;
    }

    if (newBreakpoint.behavior != this.currentBehavior) {
      this.currentBreakpoint = newBreakpoint;
      this.currentBehavior = newBreakpoint.behavior;
      switch(newBreakpoint.behavior) {
        case 'carousel':
          this.enableCarousel();
          break;
        case 'coverflow':
          this.enableCoverflow();
          break;
        default:
          console.warn('Cannot enable new behavior');
          break;
      }
    }

  };

  debouncedResize = Drupal.debounce(this.resize);

  moveToSlide(index: number) {
    if (index < 0) {
      index = this.cards.length - 1;
    } else if (index > this.cards.length - 1) {
      index = 0;
    }

    // Offset the scroll 
    const slideWidth = this.currentCard.getBoundingClientRect().width;
    const slideOffset = (window.innerWidth )

    // Special case for Safari
    if (navigator.userAgent.indexOf('Safari')) {
      this.carousel.scroll({
        left: this.cards.item(index).offsetLeft
      });
    } else {
      this.carousel.scroll({
        left: this.cards.item(index).offsetLeft,
        behavior: 'smooth'
      });
    }
    this.currentIndex = index;

    this.currentCard.classList.remove('active');
    this.currentCard = this.cards.item(index);
    this.wrapper.dataset.currentIndex = this.currentIndex.toString();
    this.currentCard.classList.add('active');
    this.setDotClasses();
  }

  updateCurrentSlide() {
    if (typeof this.isScrolling == 'number') {
      window.clearTimeout(this.isScrolling);
    }

    this.isScrolling = window.setTimeout(() => {
      let newTarget = Array.from(this.cards).find(card => {
        if(card.getBoundingClientRect().left > 0) {
          return true;
        } else {
          return false;
        }
      })!;
      this.moveToSlide(parseInt(newTarget.dataset.index!))
    }, 60);
  }

  resetTouch() {
    this.swipeStartX = 0;
    this.swipeStartY = 0;
    this.swipeDiffX = 0;
    this.swipeDiffY = 0;
    this.InterpolateCardSwipe();
  }

  handleTouchEnd(event: TouchEvent) {
    if(this.currentBehavior != 'coverflow') {
      return;
    }
    let interpolationPixelLimit = (CovershowFullwidth.interpolationLPercentageLimit * window.innerWidth);
    let interpolationAmount = Math.min(Math.max(interpolationPixelLimit, this.SwipeDiffX), 0);
    if (Math.abs(this.swipeDiffX) > Math.abs(this.swipeDiffY)) {
      if (this.swipeDiffX < 0) {
        this.animatePrevious();
      } else {
        this.animateNext();
      }
    } else {
      this.resetTouch();
    }
    this.currentCard.style.transform = '';
    this.swipeStartX = 0;
    this.swipeStartY = 0;
  }
 
  handleTouchStart(event: TouchEvent) {
    if(this.currentBehavior != 'coverflow') {
      return;
    }
    this.swipeStartX = event.touches[0].clientX;
    this.swipeStartY = event.touches[0].clientY;
    this.swipeDiffX = 0;
    this.swipeDiffY = 0;
  }

  handleTouchMove(event: TouchEvent) {
    if(this.currentBehavior != 'coverflow') {
      return;
    }
    var xUp = event.touches[0].clientX;
    var yUp = event.touches[0].clientY;
    this.swipeDiffX = this.swipeStartX - xUp;
    this.swipeDiffY = this.swipeStartY - yUp;

    if (this.currentCard) {
      this.InterpolateCardSwipe();
    }
  }
}

  const covershows = document.querySelectorAll('.covershow__full') as NodeListOf<HTMLElement>;
  covershows.forEach(covershow => {
    let p = new CovershowFullwidth(covershow);
  });
})(Drupal);