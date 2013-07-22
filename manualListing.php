<?php
require_once("database.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("Manual.php");
include_once("function.php");


if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

$manuals = Manual::find_all();


	echo "<table class=\"table\">";
	echo "<thead>";
	echo "<tr>";
	echo "<th>Manuals";
	echo "</th>";
	echo "</tr>";
	echo "<tr>";
	echo "<th>Manual</th>";
	echo "<th>Actions</th>" ;
	echo "</tr>";
	echo "</thead>";
	echo "<tbody>";
	if($manuals){
		foreach($manuals as $manual){
			echo "<tr>";
			echo "<td>" . $manual->description . "</td>";
			echo "<td><a id=\"editManual-" . $manual->id . "\" href=\"editManual.php?manualId=" . $manual->id . "\"><button type=\"button\" class=\"btn btn-warning\">Edit</button></a>" . ' ' . 
			     "<a id=\"deleteManual-" . $manual->id . "\" href=\"deleteManual.php?manualId=" . $manual->id . "\"><button type=\"button\" class=\"btn btn-danger\">Delete</button>". "</td>";
			echo "</tr>";
		}
	}
	echo "</tbody>";
	echo "</table>";

?>
<script>
	$('#manualListingBlock').unbind();
	$('#manualListingBlock').on('click','a[id*="editManual"]',function(e){
		e.preventDefault();
		e.stopPropagation();
		//alert('13');

		id = $(this).attr('id');
		manualIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		$('#addEditManualBlock').load('editManual.php', {manualId:manualIdValue});
	
	});


	$('#manualListingBlock').on("click",'a[id*="deleteManual"]', function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('delete role');

		id = $(this).attr('id');
		manualIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		deleteManualData(manualIdValue);
	});

	function deleteManualData(manualIdValue){
		$.ajax({
			type:'POST',
			url: 'manualDelete.php',
			data:{manualid:manualIdValue},
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Manual Deleted!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#manualListingBlock").load("manualListing.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Manual could not be deleted.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="manualInputForm"]')[0].reset();
			}
		});
	};

</script>

