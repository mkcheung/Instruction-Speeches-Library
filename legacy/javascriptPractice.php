<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" >
	<head>
		<script type="text/javascript">
			function addEventHandler(oNode, sEvt, fFunc, bCaptures){
				if( typeof(window.event) != "undefined"){
					oNode.attachEvent("on"+sEvt, fFunc);
				} else {
					alert('here');
					oNode.addEventListener(sEvt, fFunc, bCaptures);
				}
			}

			function setUpClickHandler(){
				alert(document.getElementById('clicklink').attr('id'));
				addEventHandler(document.getElementById('clicklink'), "click", onLinkClicked, false);
			}

			function onLinkClicked(e){
				alert("You clicked the link.");
			}

			addEventHandler(window, "load", setUpClickHandler, false);
		</script>
	</head>
	<body>
<script>
var something = new Object(); 
something.name = 'testing';
alert(something.name);

var somethingOL = {
	"name" : "somethingOLName",
	"type" : "firstOL"
}
alert(somethingOL.name);
alert(somethingOL.type);



var allianceStarships = {
	toLocaleString : function(){
		return 'Concordia';
	},
	toString : function(){
		return 'Tigers Claw';
	}
};

var starfleetShips = {
	toLocaleString : function(){
		return 'Enterprise';
	},
	toString : function(){
		return 'Excelsior';
	}
};

var fleet = Array(allianceStarships, starfleetShips);

if(Array.isArray(fleet)){
	alert(fleet.toString());
}

sample = Array('unitOne', 'unitTwo', 'unitThree');

sample.splice(1, 0, 'unitOneA');

alert(sample.toString());

sample.splice(2,0, 'A', 'B', 'C');


function Rectangle(w, h, designation){
	this.width = w;
	this.height = h;

	this.name = designation;

	this.reverse = function(){
		var reversedString = '';
		var strLen = designation.length - 1;
		for(strLen; strLen > -1 ; strLen--){
			reversedString += this.name.charAt(strLen);
		}
		return reversedString;
	}

	this.area = function(){
		return this.width * this.height;
	}

	this.max = function(){
		if(this.width > this.height){
			return this.width;
		} else if (this.width < this.height) {
			return this.height
		} else {
			return 'Width and Height are equal';
		}

	}

}

rect1 = new Rectangle(2, 5, '1-eugoR');
alert(rect1.area());
alert(rect1.reverse());
alert(rect1.max());


</script>
	<a href="#" title="click me" id="clicklink">Click Me!</a>
