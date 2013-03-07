$(document).ready(function() {

	$('#example').tooltip('hover');

	$(".navMenu li").mouseover(function(){
		$(this).addClass("active");
	}).mouseout(function(){
		$(this).removeClass("active");
	});

});