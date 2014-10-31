<?php
require_once("database.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("Club.php");
require_once("function.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}


$clubs = Club::find_all();
?>

	<table class="table">
	<thead>
	<tr>
	<th>
		Clubs
	</th>
	</tr>
	<tr>
	<th>Name</th>
	<th>Address</th>
	<th>City</th>
	<th>State</th>
	<th>Zip</th>
	<th>Password</th>
	<th>Actions</th>
	</tr>
	</thead>
	<tbody>
<?php
	if($clubs){
		foreach($clubs as $club){
?>
			<tr>
			<td><?=$club->name?></td>
			<td><?=$club->address?></td>
			<td><?=$club->city?></td>
			<td><?=$club->state?></td>
			<td><?=$club->zip?></td>
			<td><?=$club->password?></td>
			<td><a id="editClub-<?=$club->id?>" href="editClub.php?clubid=<?=$club->id?>"> <button type="button" class="btn btn-info">Edit</button></a>
			     <a id="deleteClub-<?=$club->id?>" href="deleteClub.php?clubid=<?=$club->id?>"> <button type="button" class="btn btn-danger">Delete</button></td>
			</tr>
<?php
		}
	}
?>
	</tbody>
	</table>
<script>
	$('#clubsListingBlock').unbind();
	$('#clubsListingBlock').on('click','a[id*="editClub"]', function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('6a');

		id = $(this).attr('id');
		clubIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		
		$('#addEditClubsBlock').load('editClub.php', {clubid:clubIdValue});

	});

	$('#clubsListingBlock').on('click','a[id*="deleteClub"]', function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('delete club');

		id = $(this).attr('id');
		clubIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		deleteClubData(clubIdValue);
	});

	function deleteClubData(clubId){
		$.ajax({
			type:'POST',
			url: 'clubDelete.php',
			data:{clubid:clubId},
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Club Deleted!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#clubsListingBlock").load("clubALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">This club could not be deleted.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="uploadClubsForm"]')[0].reset();
			}
		});
	};
</script>
